use std::path::{Path, PathBuf};
use std::sync::Mutex;

use folio_core::files::{self, Eol, ReadResult};
use folio_core::recent::{Kind, Recent};
use folio_core::tree::{self, TreeNode};
use serde::Serialize;
use tauri::{Manager, State};

const TREE_LIMIT: usize = 5000;

struct RecentStore {
    path: PathBuf,
    inner: Mutex<Recent>,
}

#[derive(Serialize)]
struct TreeResult {
    root: TreeNode,
    truncated: bool,
}

fn existing_paths<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter().filter(|a| Path::new(a).exists()).collect()
}

fn existing_paths_in<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .map(|a| cwd.join(a))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
fn launch_paths() -> Vec<String> {
    existing_paths(std::env::args().skip(1))
}

#[tauri::command]
fn read_file(path: String) -> Result<ReadResult, String> {
    files::read_file(Path::new(&path))
}

#[tauri::command]
fn write_file(path: String, text: String, eol: Eol, bom: bool) -> Result<(), String> {
    files::write_file(Path::new(&path), &text, eol, bom)
}

#[tauri::command]
fn list_tree(folder: String) -> Result<TreeResult, String> {
    let (root, truncated) = tree::list_tree(Path::new(&folder), TREE_LIMIT)?;
    Ok(TreeResult { root, truncated })
}

#[tauri::command]
fn recent_get(store: State<RecentStore>) -> Recent {
    store.inner.lock().unwrap().clone()
}

#[tauri::command]
fn recent_add(store: State<RecentStore>, path: String, kind: Kind) -> Result<Recent, String> {
    let mut guard = store.inner.lock().unwrap();
    let mut next = guard.clone();
    next.add(&path, kind);
    next.save(&store.path)?;
    *guard = next.clone();
    Ok(next)
}

#[tauri::command]
fn recent_remove(store: State<RecentStore>, path: String) -> Result<Recent, String> {
    let mut guard = store.inner.lock().unwrap();
    let mut next = guard.clone();
    next.remove(&path);
    next.save(&store.path)?;
    *guard = next.clone();
    Ok(next)
}

pub fn run() {
    use tauri::Emitter;

    tauri::Builder::default()
        // Must be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = existing_paths_in(argv.into_iter().skip(1), Path::new(&cwd));
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let path = dir.join("recent.json");
            let recent = Recent::load(&path);
            app.manage(RecentStore {
                path,
                inner: Mutex::new(recent),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_paths,
            read_file,
            write_file,
            list_tree,
            recent_get,
            recent_add,
            recent_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folio");
}
