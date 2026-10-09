use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::Engine;
use folio_core::drafts::{self, Draft};
use folio_core::fileops;
use folio_core::files::{self, Eol, ReadResult};
use folio_core::image;
use folio_core::recent::{Kind, Recent};
use folio_core::search::{self, FileMatches};
use folio_core::settings::{self, Settings};
use folio_core::tree::{self, TreeNode};
use folio_core::watch::{ChangeKind, WatchEvent, Watcher};
use serde::Serialize;
use tauri::{Manager, State};

const TREE_LIMIT: usize = 5000;
const SEARCH_LIMIT: usize = 1000;

struct RecentStore {
    path: PathBuf,
    inner: Mutex<Recent>,
}

struct SettingsStore {
    path: PathBuf,
    inner: Mutex<Settings>,
}

/// The crash-recovery drafts directory; the lock keeps a save and a delete
/// of the same draft from interleaving.
struct DraftStore {
    dir: PathBuf,
    lock: Mutex<()>,
}

#[derive(Serialize)]
struct TreeResult {
    root: TreeNode,
    truncated: bool,
}

fn existing_paths_in<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .map(|a| cwd.join(a))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Paths from second launches that arrive before the frontend is listening.
/// The frontend subscribes to `open-paths` and then calls `launch_paths`,
/// which marks it ready and drains anything queued here.
#[derive(Default)]
struct Pending {
    ready: bool,
    paths: Vec<String>,
}

impl Pending {
    /// Called by `launch_paths`: returns own argv paths plus queued ones.
    fn take_launch(&mut self, mut own: Vec<String>) -> Vec<String> {
        self.ready = true;
        own.append(&mut self.paths);
        own
    }

    /// Called for a second launch: Some(paths) to emit now, None if queued.
    fn route(&mut self, paths: Vec<String>) -> Option<Vec<String>> {
        if self.ready {
            Some(paths)
        } else {
            self.paths.extend(paths);
            None
        }
    }
}

struct PendingOpen(Mutex<Pending>);

#[tauri::command]
fn launch_paths(pending: State<PendingOpen>) -> Vec<String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    let own = existing_paths_in(
        std::env::args_os()
            .skip(1)
            .map(|a| a.to_string_lossy().into_owned()),
        &cwd,
    );
    pending.0.lock().unwrap().take_launch(own)
}

// File-system commands are async: they run on a worker thread, so a slow
// disk or a big folder never blocks the window (the main thread).
#[tauri::command(async)]
fn read_file(path: String) -> Result<ReadResult, String> {
    files::read_file(Path::new(&path))
}

#[tauri::command(async)]
fn write_file(path: String, text: String, eol: Eol, bom: bool) -> Result<(), String> {
    files::write_file(Path::new(&path), &text, eol, bom)
}

#[tauri::command(async)]
fn write_image(path: String, base64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|_| "invalid image data".to_string())?;
    image::write_image(Path::new(&path), &bytes)
}

#[tauri::command(async)]
fn read_image(path: String) -> Result<String, String> {
    let bytes = image::read_image(Path::new(&path))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// The four file operations below trust the frontend for containment: they
// accept any absolute local path (folio-core refuses relative and UNC/device
// paths). That the target lies inside the open folder is enforced by the JS
// guard in main.js (`insideFolder` / `inFolderOrRoot`).
#[tauri::command(async)]
fn create_file(path: String) -> Result<(), String> {
    fileops::create_file(Path::new(&path))
}

#[tauri::command(async)]
fn create_dir(path: String) -> Result<(), String> {
    fileops::create_dir(Path::new(&path))
}

#[tauri::command(async)]
fn rename_path(from: String, to: String) -> Result<(), String> {
    fileops::rename_path(Path::new(&from), Path::new(&to))
}

#[tauri::command(async)]
fn trash_path(path: String) -> Result<(), String> {
    fileops::trash_path(Path::new(&path))
}

#[tauri::command(async)]
fn list_tree(folder: String) -> Result<TreeResult, String> {
    let (root, truncated) = tree::list_tree(Path::new(&folder), TREE_LIMIT)?;
    Ok(TreeResult { root, truncated })
}

/// Id of the newest `search_folder` request; older running searches see it
/// change and stop.
#[derive(Default)]
struct LatestSearch(AtomicU64);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchReply {
    request_id: u64,
    files: Vec<FileMatches>,
    truncated: bool,
}

#[tauri::command(async)]
fn search_folder(
    latest: State<LatestSearch>,
    folder: String,
    query: String,
    match_case: bool,
    request_id: u64,
) -> Result<SearchReply, String> {
    // fetch_max: a late-running older request can never lower the id and
    // cancel a newer one.
    latest.0.fetch_max(request_id, Ordering::SeqCst);
    let cancel = || latest.0.load(Ordering::SeqCst) > request_id;
    let r = search::search_folder(Path::new(&folder), &query, match_case, SEARCH_LIMIT, &cancel)?;
    Ok(SearchReply {
        request_id,
        files: r.files,
        truncated: r.truncated,
    })
}

/// The file/folder watcher; None if it could not be started (the app then
/// works without reload-on-change).
struct WatchState(Mutex<Option<Watcher>>);

#[derive(Clone, Serialize)]
struct FileChanged {
    path: String,
    kind: ChangeKind,
}

#[derive(Clone, Serialize)]
struct FolderChanged {
    folder: String,
}

fn start_watcher(app: tauri::AppHandle) -> Option<Watcher> {
    use tauri::Emitter;

    let watcher = Watcher::new(move |event| {
        let _ = match event {
            WatchEvent::File { path, kind } => app.emit(
                "file-changed",
                FileChanged {
                    path: path.to_string_lossy().into_owned(),
                    kind,
                },
            ),
            WatchEvent::Folder { folder } => app.emit(
                "folder-changed",
                FolderChanged {
                    folder: folder.to_string_lossy().into_owned(),
                },
            ),
        };
    });
    match watcher {
        Ok(w) => Some(w),
        Err(e) => {
            eprintln!("file watcher unavailable: {e}");
            None
        }
    }
}

#[tauri::command(async)]
fn watch(state: State<WatchState>, files: Vec<String>, folder: Option<String>) {
    if let Some(w) = state.0.lock().unwrap().as_mut() {
        w.set(
            files.into_iter().map(PathBuf::from).collect(),
            folder.map(PathBuf::from),
        );
    }
}

#[tauri::command(async)]
fn recent_get(store: State<RecentStore>) -> Recent {
    store.inner.lock().unwrap().clone()
}

#[tauri::command(async)]
fn recent_add(store: State<RecentStore>, path: String, kind: Kind) -> Result<Recent, String> {
    let mut guard = store.inner.lock().unwrap();
    let mut next = guard.clone();
    next.add(&path, kind);
    next.save(&store.path)?;
    *guard = next.clone();
    Ok(next)
}

#[tauri::command(async)]
fn recent_remove(store: State<RecentStore>, path: String) -> Result<Recent, String> {
    let mut guard = store.inner.lock().unwrap();
    let mut next = guard.clone();
    next.remove(&path);
    next.save(&store.path)?;
    *guard = next.clone();
    Ok(next)
}

#[tauri::command(async)]
fn settings_get(store: State<SettingsStore>) -> Settings {
    store.inner.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[tauri::command(async)]
fn settings_set(store: State<SettingsStore>, settings: Settings) -> Result<(), String> {
    let mut guard = store.inner.lock().unwrap_or_else(|e| e.into_inner());
    settings::save(&store.path, &settings)?;
    *guard = settings;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    updater_configured: bool,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        updater_configured: false,
    }
}

#[tauri::command(async)]
fn drafts_list(store: State<DraftStore>) -> Vec<Draft> {
    let _guard = store.lock.lock().unwrap_or_else(|e| e.into_inner());
    drafts::list(&store.dir)
}

#[tauri::command(async)]
fn draft_save(store: State<DraftStore>, draft: Draft) -> Result<(), String> {
    let _guard = store.lock.lock().unwrap_or_else(|e| e.into_inner());
    drafts::save(&store.dir, &draft)
}

#[tauri::command(async)]
fn draft_delete(store: State<DraftStore>, id: String) -> Result<(), String> {
    let _guard = store.lock.lock().unwrap_or_else(|e| e.into_inner());
    drafts::delete(&store.dir, &id)
}

pub fn run() {
    use tauri::Emitter;

    tauri::Builder::default()
        // Must be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = existing_paths_in(argv.into_iter().skip(1), Path::new(&cwd));
            if !paths.is_empty() {
                // Hold the lock across the check and the emit so launch_paths
                // can't mark ready in between and miss these paths.
                let state = app.state::<PendingOpen>();
                let mut pending = state.0.lock().unwrap();
                if let Some(paths) = pending.route(paths) {
                    let _ = app.emit("open-paths", paths);
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(PendingOpen(Mutex::new(Pending::default())))
        .manage(LatestSearch::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(DraftStore {
                dir: dir.join("drafts"),
                lock: Mutex::new(()),
            });
            let path = dir.join("recent.json");
            let recent = Recent::load(&path);
            app.manage(RecentStore {
                path,
                inner: Mutex::new(recent),
            });
            let settings_path = dir.join("settings.json");
            app.manage(SettingsStore {
                inner: Mutex::new(settings::load(&settings_path)),
                path: settings_path,
            });
            app.manage(WatchState(Mutex::new(start_watcher(app.handle().clone()))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_paths,
            read_file,
            write_file,
            write_image,
            read_image,
            create_file,
            create_dir,
            rename_path,
            trash_path,
            list_tree,
            search_folder,
            watch,
            recent_get,
            recent_add,
            recent_remove,
            drafts_list,
            draft_save,
            draft_delete,
            settings_get,
            settings_set,
            app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folio");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_launch_before_ready_is_queued_then_drained() {
        let mut p = Pending::default();
        assert_eq!(p.route(vec!["b.md".into()]), None);
        assert_eq!(p.route(vec!["c.md".into()]), None);
        let got = p.take_launch(vec!["a.md".into()]);
        assert_eq!(got, vec!["a.md", "b.md", "c.md"]);
        assert!(p.paths.is_empty());
    }

    #[test]
    fn second_launch_after_ready_is_emitted() {
        let mut p = Pending::default();
        assert!(p.take_launch(vec![]).is_empty());
        assert_eq!(p.route(vec!["d.md".into()]), Some(vec!["d.md".to_string()]));
        assert!(p.paths.is_empty());
    }

    #[test]
    fn relative_argv_is_made_absolute_against_cwd() {
        let dir = std::env::temp_dir().join(format!("folio-argv-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("x.md"), "x").unwrap();
        let got = existing_paths_in(vec!["x.md".to_string(), "missing.md".to_string()], &dir);
        assert_eq!(got, vec![dir.join("x.md").to_string_lossy().into_owned()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
