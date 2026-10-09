//! Writing a pasted image next to its document.

use std::fs;
use std::io;
use std::path::Path;

/// Same list as the asset scope in tauri.conf.json (case-insensitive).
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];

fn io_err(e: io::Error) -> String {
    match e.kind() {
        io::ErrorKind::PermissionDenied => "permission denied".to_string(),
        io::ErrorKind::AlreadyExists => "already exists".to_string(),
        _ => e.to_string(),
    }
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// Writes `bytes` to `path` without ever replacing an existing file.
///
/// The parent folder is created. The data goes through `atomic_write` (exclusive
/// temp file, fsync, rename), so a half-written image never has the final
/// name. Residual race: a file created by someone else between the final
/// existence check and the rename would be overwritten; the window is a few
/// microseconds and the target name is timestamped, so it is accepted.
pub fn write_image(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !is_image(path) {
        return Err("not an image file".to_string());
    }
    if path.exists() {
        return Err("already exists".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(io_err)?;
    }

    crate::atomic::atomic_write(path, bytes, true).map_err(io_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_creates_parent() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("images").join("a.PNG");
        write_image(&p, &[1, 2, 3]).unwrap();
        assert_eq!(fs::read(&p).unwrap(), vec![1, 2, 3]);
        assert!(fs::read_dir(p.parent().unwrap())
            .unwrap()
            .all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".folio-tmp")));
    }

    #[test]
    fn refuses_non_image() {
        let d = tempfile::tempdir().unwrap();
        for name in ["a.txt", "a.md", "noext", "a.png.exe"] {
            let p = d.path().join(name);
            assert_eq!(write_image(&p, b"x").unwrap_err(), "not an image file");
            assert!(!p.exists());
        }
        assert!(!d.path().join("images").exists());
    }

    #[test]
    fn refuses_existing() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.png");
        fs::write(&p, "old").unwrap();
        assert_eq!(write_image(&p, b"new").unwrap_err(), "already exists");
        assert_eq!(fs::read_to_string(&p).unwrap(), "old");
    }

    #[test]
    fn accepts_every_listed_extension() {
        let d = tempfile::tempdir().unwrap();
        for e in IMAGE_EXTENSIONS {
            write_image(&d.path().join(format!("x.{e}")), b"x").unwrap();
        }
    }
}
