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

/// Largest image `read_image` returns (export embeds it as base64).
pub const MAX_READ_BYTES: u64 = 10 * 1024 * 1024;

/// Reads an image file for embedding. Same extension rule as `write_image`;
/// the path must be absolute and local (no UNC or device paths); files over
/// 10 MB fail with "too large" even if they grow after the size check.
pub fn read_image(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    if !crate::paths::is_plain_absolute(path) {
        return Err("not a local path".to_string());
    }
    if !is_image(path) {
        return Err("not an image file".to_string());
    }
    let file = fs::File::open(path).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound { "file not found".to_string() } else { io_err(e) }
    })?;
    let meta = file.metadata().map_err(io_err)?;
    if !meta.is_file() {
        return Err("not an image file".to_string());
    }
    if meta.len() > MAX_READ_BYTES {
        return Err("too large".to_string());
    }
    let mut bytes = Vec::new();
    file.take(MAX_READ_BYTES + 1).read_to_end(&mut bytes).map_err(io_err)?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err("too large".to_string());
    }
    Ok(bytes)
}

/// Writes `bytes` to `path` without ever replacing an existing file.
///
/// The parent folder is created. The data goes through `atomic_write` (exclusive
/// temp file, fsync, rename), so a half-written image never has the final
/// name. Residual race: a file created by someone else between the final
/// existence check and the rename would be overwritten; the window is a few
/// microseconds and the target name is timestamped, so it is accepted.
pub fn write_image(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !crate::paths::is_plain_absolute(path) {
        return Err("not a local path".to_string());
    }
    let in_images = path
        .parent()
        .and_then(|p| p.file_name())
        .is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("images"));
    if !in_images {
        return Err("not an images folder".to_string());
    }
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
    fn refuses_relative_remote_and_outside_images_folder() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(write_image(Path::new("images/a.png"), b"x").unwrap_err(), "not a local path");
        for p in ["\\\\server\\share\\images\\a.png", "//server/share/images/a.png"] {
            assert_eq!(write_image(Path::new(p), b"x").unwrap_err(), "not a local path", "{p}");
        }
        for rel in ["a.png", "pics/a.png", "images2/a.png", "images/sub/a.png"] {
            let p = d.path().join(rel);
            assert_eq!(write_image(&p, b"x").unwrap_err(), "not an images folder", "{rel}");
            assert!(!p.exists());
        }
        assert!(!d.path().join("pics").exists());
        write_image(&d.path().join("IMAGES").join("a.png"), b"x").unwrap();
    }

    #[test]
    fn refuses_non_image() {
        let d = tempfile::tempdir().unwrap();
        for name in ["a.txt", "a.md", "noext", "a.png.exe"] {
            let p = d.path().join("images").join(name);
            assert_eq!(write_image(&p, b"x").unwrap_err(), "not an image file");
            assert!(!p.exists());
        }
        assert!(!d.path().join("images").exists());
    }

    #[test]
    fn reads_image_and_refuses_bad_ones() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.PNG");
        fs::write(&p, [1, 2, 3]).unwrap();
        assert_eq!(read_image(&p).unwrap(), vec![1, 2, 3]);
        let t = d.path().join("a.txt");
        fs::write(&t, "x").unwrap();
        assert_eq!(read_image(&t).unwrap_err(), "not an image file");
        assert_eq!(read_image(&d.path().join("gone.png")).unwrap_err(), "file not found");
        let big = d.path().join("big.png");
        let f = fs::File::create(&big).unwrap();
        f.set_len(MAX_READ_BYTES + 1).unwrap();
        assert_eq!(read_image(&big).unwrap_err(), "too large");
        f.set_len(MAX_READ_BYTES).unwrap();
        assert_eq!(read_image(&big).unwrap().len() as u64, MAX_READ_BYTES);
    }

    #[test]
    fn read_refuses_unc_and_relative_paths() {
        for p in ["\\\\server\\share\\a.png", "//server/share/a.png", "a.png", "img/a.png"] {
            assert_eq!(read_image(Path::new(p)).unwrap_err(), "not a local path", "{p}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn read_refuses_windows_device_prefixes() {
        for p in [r"\\?\UNC\server\share\a.png", r"\\.\C:\a.png"] {
            assert_eq!(read_image(Path::new(p)).unwrap_err(), "not a local path", "{p}");
        }
    }

    #[test]
    fn refuses_existing() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("images").join("a.png");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, "old").unwrap();
        assert_eq!(write_image(&p, b"new").unwrap_err(), "already exists");
        assert_eq!(fs::read_to_string(&p).unwrap(), "old");
    }

    #[test]
    fn accepts_every_listed_extension() {
        let d = tempfile::tempdir().unwrap();
        for e in IMAGE_EXTENSIONS {
            write_image(&d.path().join("images").join(format!("x.{e}")), b"x").unwrap();
        }
    }
}
