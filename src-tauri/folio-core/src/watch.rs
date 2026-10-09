//! File and folder watching.
//!
//! Open files are watched through their parent folders (non-recursive), and
//! the raw events are filtered down to the watched paths: an editor's
//! "write a temp file, rename it over the target" save replaces the file's
//! inode, which a watch on the file itself would lose. The sidebar folder is
//! watched recursively. Files are debounced at 300 ms, the folder at 500 ms.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;

const FILE_DEBOUNCE: Duration = Duration::from_millis(300);
const FOLDER_DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Modified,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchEvent {
    /// A watched file changed (`path` is spelled as it was given to `set`).
    File { path: PathBuf, kind: ChangeKind },
    /// Something inside the watched folder changed.
    Folder { folder: PathBuf },
}

/// Comparison key for paths. Windows paths are case-insensitive and accept
/// either separator. Removed files can't be canonicalised, so this compares
/// spellings, not filesystem identity.
fn key(p: &Path) -> String {
    key_for(&p.to_string_lossy(), cfg!(windows))
}

/// `key` without the platform switch, so both branches are tested everywhere.
fn key_for(s: &str, windows: bool) -> String {
    if windows {
        s.replace('/', "\\").to_lowercase()
    } else {
        s.to_owned()
    }
}

type Handler = Arc<Mutex<dyn FnMut(WatchEvent) + Send>>;

pub struct Watcher {
    files: Debouncer<RecommendedWatcher>,
    folder: Debouncer<RecommendedWatcher>,
    /// key -> path as given, shared with the file debouncer's callback.
    watched_files: Arc<Mutex<HashMap<String, PathBuf>>>,
    /// Shared with the folder debouncer's callback.
    watched_folder: Arc<Mutex<Option<PathBuf>>>,
    /// Parent folders currently under a (non-recursive) watch, by key.
    dirs: HashMap<String, PathBuf>,
    folder_watched: Option<PathBuf>,
}

impl Watcher {
    pub fn new(on_event: impl Fn(WatchEvent) + Send + 'static) -> Result<Watcher, String> {
        let handler: Handler = Arc::new(Mutex::new(on_event));
        let watched_files: Arc<Mutex<HashMap<String, PathBuf>>> = Arc::default();
        let watched_folder: Arc<Mutex<Option<PathBuf>>> = Arc::default();

        let files = {
            let handler = handler.clone();
            let watched = watched_files.clone();
            new_debouncer(FILE_DEBOUNCE, move |res: DebounceEventResult| {
                let Ok(events) = res else { return };
                let mut seen = HashSet::new();
                let changed: Vec<PathBuf> = {
                    let watched = watched.lock().unwrap();
                    events
                        .iter()
                        .filter_map(|e| watched.get(&key(&e.path)))
                        .filter(|p| seen.insert(key(p)))
                        .cloned()
                        .collect()
                };
                for path in changed {
                    let kind = if path.exists() {
                        ChangeKind::Modified
                    } else {
                        ChangeKind::Removed
                    };
                    (handler.lock().unwrap())(WatchEvent::File { path, kind });
                }
            })
            .map_err(|e| e.to_string())?
        };

        let folder = {
            let watched = watched_folder.clone();
            new_debouncer(FOLDER_DEBOUNCE, move |res: DebounceEventResult| {
                let Ok(events) = res else { return };
                if events.is_empty() {
                    return;
                }
                let current = watched.lock().unwrap().clone();
                if let Some(folder) = current {
                    (handler.lock().unwrap())(WatchEvent::Folder { folder });
                }
            })
            .map_err(|e| e.to_string())?
        };

        Ok(Watcher {
            files,
            folder,
            watched_files,
            watched_folder,
            dirs: HashMap::new(),
            folder_watched: None,
        })
    }

    /// Replaces the whole watched set. Best effort: a folder that can't be
    /// watched (e.g. it no longer exists) is skipped and retried next time.
    pub fn set(&mut self, files: Vec<PathBuf>, folder: Option<PathBuf>) {
        let mut wanted_files = HashMap::new();
        let mut wanted_dirs = HashMap::new();
        for f in files {
            if let Some(dir) = f.parent().filter(|d| !d.as_os_str().is_empty()) {
                wanted_dirs.insert(key(dir), dir.to_path_buf());
            }
            wanted_files.insert(key(&f), f);
        }
        *self.watched_files.lock().unwrap() = wanted_files;

        let watcher = self.files.watcher();
        self.dirs.retain(|k, dir| {
            wanted_dirs.contains_key(k) || {
                let _ = watcher.unwatch(dir);
                false
            }
        });
        for (k, dir) in wanted_dirs {
            if !self.dirs.contains_key(&k)
                && watcher.watch(&dir, RecursiveMode::NonRecursive).is_ok()
            {
                self.dirs.insert(k, dir);
            }
        }

        let same = match (&self.folder_watched, &folder) {
            (Some(a), Some(b)) => key(a) == key(b),
            (None, None) => true,
            _ => false,
        };
        *self.watched_folder.lock().unwrap() = folder.clone();
        if !same || (folder.is_some() && self.folder_watched.is_none()) {
            let watcher = self.folder.watcher();
            if let Some(old) = self.folder_watched.take() {
                let _ = watcher.unwatch(&old);
            }
            if let Some(new) = folder {
                if watcher.watch(&new, RecursiveMode::Recursive).is_ok() {
                    self.folder_watched = Some(new);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::sync::mpsc::{channel, Receiver};
    use std::time::Instant;

    const WAIT: Duration = Duration::from_secs(3);
    const QUIET: Duration = Duration::from_millis(1500);

    fn watcher() -> (Watcher, Receiver<WatchEvent>) {
        let (tx, rx) = channel();
        let w = Watcher::new(move |e| {
            let _ = tx.send(e);
        })
        .unwrap();
        (w, rx)
    }

    /// Waits up to `limit` for an event matching `want`, skipping others.
    fn wait_for(
        rx: &Receiver<WatchEvent>,
        limit: Duration,
        want: impl Fn(&WatchEvent) -> bool,
    ) -> bool {
        let end = Instant::now() + limit;
        while let Some(left) = end.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(left) {
                Ok(e) if want(&e) => return true,
                Ok(_) => continue,
                Err(_) => return false,
            }
        }
        false
    }

    fn append(path: &Path, text: &str) {
        let mut f = fs::OpenOptions::new().append(true).open(path).unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }

    #[test]
    fn key_folds_case_and_separators_on_windows_only() {
        assert_eq!(
            key_for("C:/Users/Me/Notes\\A.MD", true),
            key_for("c:\\users\\me\\notes/a.md", true)
        );
        assert_eq!(key_for("C:/Users/Me/A.MD", true), "c:\\users\\me\\a.md");
        // POSIX paths are case-sensitive and "\\" is an ordinary character.
        assert_eq!(key_for("/home/Me/A.md", false), "/home/Me/A.md");
        assert_ne!(key_for("/x/A.md", false), key_for("/x/a.md", false));
        assert_ne!(key_for("/x/a\\b.md", false), key_for("/x/a/b.md", false));
    }

    #[test]
    fn modify_emits_file_event() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        fs::write(&file, "one\n").unwrap();
        let (mut w, rx) = watcher();
        w.set(vec![file.clone()], None);
        append(&file, "two\n");
        assert!(wait_for(&rx, WAIT, |e| *e
            == WatchEvent::File {
                path: file.clone(),
                kind: ChangeKind::Modified
            }));
    }

    #[test]
    fn rename_over_target_emits_modified() {
        // Our own atomic save: write a temp file, rename it over the target.
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        fs::write(&file, "one\n").unwrap();
        let (mut w, rx) = watcher();
        w.set(vec![file.clone()], None);
        let tmp = dir.path().join("a.md.folio-tmp");
        fs::write(&tmp, "two\n").unwrap();
        fs::rename(&tmp, &file).unwrap();
        assert!(wait_for(&rx, WAIT, |e| *e
            == WatchEvent::File {
                path: file.clone(),
                kind: ChangeKind::Modified
            }));
    }

    #[test]
    fn delete_emits_removed() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        fs::write(&file, "one\n").unwrap();
        let (mut w, rx) = watcher();
        w.set(vec![file.clone()], None);
        fs::remove_file(&file).unwrap();
        assert!(wait_for(&rx, WAIT, |e| *e
            == WatchEvent::File {
                path: file.clone(),
                kind: ChangeKind::Removed
            }));
    }

    #[test]
    fn set_replaces_watch_set() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        let other = dir.path().join("b.md");
        fs::write(&file, "one\n").unwrap();
        fs::write(&other, "one\n").unwrap();
        let (mut w, rx) = watcher();
        w.set(vec![file.clone()], None);
        // Same folder still watched (for b.md): a.md's events must be filtered.
        w.set(vec![other.clone()], None);
        append(&file, "two\n");
        assert!(
            !wait_for(&rx, QUIET, |_| true),
            "no event expected for an unwatched file"
        );
        // Nothing watched at all.
        w.set(vec![], None);
        append(&other, "two\n");
        assert!(
            !wait_for(&rx, QUIET, |_| true),
            "no event expected after clearing the set"
        );
    }

    #[test]
    fn other_files_in_the_folder_are_filtered() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        let other = dir.path().join("b.md");
        fs::write(&file, "one\n").unwrap();
        fs::write(&other, "one\n").unwrap();
        let (mut w, rx) = watcher();
        w.set(vec![file.clone()], None);
        append(&other, "two\n");
        append(&file, "two\n");
        let mut got = Vec::new();
        while let Ok(e) = rx.recv_timeout(QUIET) {
            got.push(e);
        }
        // One write can straddle two debounce windows and arrive twice; the
        // point here is that b.md never shows up.
        let expected = WatchEvent::File {
            path: file,
            kind: ChangeKind::Modified,
        };
        assert!(!got.is_empty(), "expected an event for a.md");
        assert!(
            got.iter().all(|e| *e == expected),
            "unexpected events: {got:?}"
        );
    }

    #[test]
    fn folder_add_emits_folder_event() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().to_path_buf();
        fs::create_dir(folder.join("sub")).unwrap();
        let (mut w, rx) = watcher();
        w.set(vec![], Some(folder.clone()));
        // Recursive: a file added in a subfolder counts.
        fs::write(folder.join("sub").join("new.md"), "# new\n").unwrap();
        assert!(wait_for(&rx, WAIT, |e| *e
            == WatchEvent::Folder {
                folder: folder.clone()
            }));
    }
}
