//! One crash-safe write: temp file in the same folder, fsync, rename.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// Writes `bytes` to `path` through `<name>.folio-tmp`: the data is synced to
/// disk before the rename, so after a power cut `path` holds either the old
/// or the new content, never a half-written file. The temp file is removed
/// on error.
///
/// `no_overwrite`: the temp file is created exclusively and an existing
/// `path` fails with `AlreadyExists` (checked again just before the rename;
/// the remaining window is a few microseconds).
pub fn atomic_write(path: &Path, bytes: &[u8], no_overwrite: bool) -> io::Result<()> {
    let mut tmp_name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid file path"))?
        .to_os_string();
    tmp_name.push(".folio-tmp");
    let tmp = path.with_file_name(tmp_name);

    let result = (|| {
        let mut opts = OpenOptions::new();
        opts.write(true);
        if no_overwrite {
            opts.create_new(true);
        } else {
            opts.create(true).truncate(true);
        }
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if no_overwrite && path.exists() {
            return Err(io::Error::from(io::ErrorKind::AlreadyExists));
        }
        fs::rename(&tmp, path)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    sync_parent(path);
    Ok(())
}

/// Best effort: make the rename itself durable (Unix only; Windows can't
/// open a directory for syncing).
fn sync_parent(path: &Path) {
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        if let Ok(d) = fs::File::open(parent) {
            let _ = d.sync_all();
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_replaces_without_leftovers() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.txt");
        atomic_write(&p, b"one", false).unwrap();
        atomic_write(&p, b"two", false).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"two");
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn no_overwrite_keeps_existing_and_cleans_up() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.txt");
        atomic_write(&p, b"one", true).unwrap();
        let e = atomic_write(&p, b"two", true).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&p).unwrap(), b"one");
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn failure_removes_temp() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("dir");
        fs::create_dir(&p).unwrap();
        assert!(atomic_write(&p, b"x", false).is_err()); // rename onto a directory
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 1);
    }
}
