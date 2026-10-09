//! Sidebar file operations: create, rename and move to the Recycle Bin.
//! Every function takes absolute local paths only (see `paths`); errors are
//! short readable strings ("already exists", "not found", ...).

use std::fs;
use std::io;
use std::path::Path;

use crate::paths::is_plain_absolute;

fn io_err(e: io::Error) -> String {
    match e.kind() {
        io::ErrorKind::PermissionDenied => "permission denied".to_string(),
        io::ErrorKind::AlreadyExists => "already exists".to_string(),
        io::ErrorKind::NotFound => "not found".to_string(),
        _ => e.to_string(),
    }
}

fn guard(path: &Path) -> Result<(), String> {
    if is_plain_absolute(path) {
        Ok(())
    } else {
        Err("not a local path".to_string())
    }
}

/// Creates an empty file; fails with "already exists" rather than touching
/// an existing one.
pub fn create_file(path: &Path) -> Result<(), String> {
    guard(path)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(|_| ())
        .map_err(io_err)
}

/// Creates one folder (the parent must exist).
pub fn create_dir(path: &Path) -> Result<(), String> {
    guard(path)?;
    fs::create_dir(path).map_err(io_err)
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// True when both paths name the same file-system entry.
fn same_entry(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(x), Ok(y)) = (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
            return x.dev() == y.dev() && x.ino() == y.ino();
        }
    }
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

/// `from` and `to` are in the same folder and differ only in letter case.
fn is_case_only(from: &Path, to: &Path) -> bool {
    let (Some(pf), Some(pt)) = (from.parent(), to.parent()) else { return false };
    let (Some(nf), Some(nt)) = (from.file_name(), to.file_name()) else { return false };
    pf == pt && nf != nt && nf.to_string_lossy().to_lowercase() == nt.to_string_lossy().to_lowercase()
}

/// Renames in two steps through a temporary name (Windows cannot always
/// change only the case of a name in one move).
fn rename_via_temp(from: &Path, to: &Path) -> Result<(), String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = from.with_file_name(format!("{name}.folio-rename-{:x}{:x}", std::process::id(), nanos));
    if exists(&tmp) {
        return Err("already exists".to_string());
    }
    fs::rename(from, &tmp).map_err(io_err)?;
    if let Err(e) = fs::rename(&tmp, to) {
        let _ = fs::rename(&tmp, from); // put it back
        return Err(io_err(e));
    }
    Ok(())
}

/// Renames or moves a file or folder. Never replaces an existing entry
/// ("already exists"), except that changing only the case of a name is
/// allowed; a missing `from` is "not found".
pub fn rename_path(from: &Path, to: &Path) -> Result<(), String> {
    guard(from)?;
    guard(to)?;
    if !exists(from) {
        return Err("not found".to_string());
    }
    if exists(to) {
        if is_case_only(from, to) && same_entry(from, to) {
            return if cfg!(windows) { rename_via_temp(from, to) } else { fs::rename(from, to).map_err(io_err) };
        }
        return Err("already exists".to_string());
    }
    fs::rename(from, to).map_err(io_err)
}

/// Moves a file or folder to the Recycle Bin / Trash.
pub fn trash_path(path: &Path) -> Result<(), String> {
    guard(path)?;
    if !exists(path) {
        return Err("not found".to_string());
    }
    trash::delete(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn create_file_and_exists_error() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        create_file(&p).unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"");
        fs::write(&p, "keep").unwrap();
        assert_eq!(create_file(&p).unwrap_err(), "already exists");
        assert_eq!(fs::read_to_string(&p).unwrap(), "keep");
        assert_eq!(create_file(&d.path().join("no/such/a.md")).unwrap_err(), "not found");
    }

    #[test]
    fn create_dir_and_exists_error() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("sub");
        create_dir(&p).unwrap();
        assert!(p.is_dir());
        assert_eq!(create_dir(&p).unwrap_err(), "already exists");
    }

    #[test]
    fn relative_and_unc_paths_are_refused() {
        for p in ["a.md", "x/a.md", "//server/share/a.md", "\\\\server\\share\\a.md"] {
            let p = Path::new(p);
            assert_eq!(create_file(p).unwrap_err(), "not a local path");
            assert_eq!(create_dir(p).unwrap_err(), "not a local path");
            assert_eq!(trash_path(p).unwrap_err(), "not a local path");
            assert_eq!(rename_path(p, p).unwrap_err(), "not a local path");
        }
    }

    #[test]
    fn rename_and_exists_error() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.md"), d.path().join("b.md"));
        fs::write(&a, "A").unwrap();
        rename_path(&a, &b).unwrap();
        assert!(!a.exists());
        assert_eq!(fs::read_to_string(&b).unwrap(), "A");
        // Target exists: refused, both untouched.
        fs::write(&a, "other").unwrap();
        assert_eq!(rename_path(&a, &b).unwrap_err(), "already exists");
        assert_eq!(fs::read_to_string(&a).unwrap(), "other");
        assert_eq!(fs::read_to_string(&b).unwrap(), "A");
        // Missing source.
        assert_eq!(rename_path(&d.path().join("gone.md"), &d.path().join("x.md")).unwrap_err(), "not found");
        // Folders too.
        let (s, t) = (d.path().join("s"), d.path().join("t"));
        fs::create_dir(&s).unwrap();
        fs::write(s.join("in.md"), "i").unwrap();
        rename_path(&s, &t).unwrap();
        assert!(t.join("in.md").exists());
    }

    #[test]
    fn case_only_rename() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("Note.md"), d.path().join("note.md"));
        fs::write(&a, "N").unwrap();
        rename_path(&a, &b).unwrap();
        assert_eq!(names(d.path()), vec!["note.md"]);
        assert_eq!(fs::read_to_string(&b).unwrap(), "N");
        // Folder, and back again.
        let (f, g) = (d.path().join("Sub"), d.path().join("SUB"));
        fs::create_dir(&f).unwrap();
        rename_path(&f, &g).unwrap();
        assert_eq!(names(d.path()), vec!["SUB", "note.md"]);
    }

    #[test]
    fn rename_through_temp_name_leaves_no_temp_file() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("Note.md"), d.path().join("note.md"));
        fs::write(&a, "N").unwrap();
        rename_via_temp(&a, &b).unwrap();
        assert_eq!(names(d.path()), vec!["note.md"]);
    }

    #[test]
    fn different_file_with_same_lowercase_name_is_not_a_case_only_rename() {
        // On a case-sensitive file system both can exist; renaming one onto
        // the other must still be refused. (On a case-insensitive one the
        // second create fails and there is nothing to check.)
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("Note.md"), d.path().join("note.md"));
        fs::write(&a, "A").unwrap();
        if create_file(&b).is_err() {
            return;
        }
        assert_eq!(rename_path(&a, &b).unwrap_err(), "already exists");
    }

    #[test]
    fn trash_removes_from_folder() {
        let d = tempfile::tempdir().unwrap();
        // The freedesktop trash lives under XDG_DATA_HOME; keep it on the
        // same file system as the file so the move is a rename.
        #[cfg(all(unix, not(target_os = "macos")))]
        std::env::set_var("XDG_DATA_HOME", d.path().join("xdg"));
        let dir = d.path().join("proj");
        fs::create_dir(&dir).unwrap();
        let f = dir.join("gone.md");
        fs::write(&f, "x").unwrap();
        let sub = dir.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("in.md"), "y").unwrap();
        let r = trash_path(&f).and_then(|_| trash_path(&sub));
        match r {
            Ok(()) => assert!(names(&dir).is_empty(), "{:?}", names(&dir)),
            Err(e) if cfg!(any(windows, target_os = "macos")) => panic!("trash failed: {e}"),
            Err(e) => {
                // No usable freedesktop trash on this runner: nothing to check.
                eprintln!("skipping trash check, no trash available here: {e}");
                return;
            }
        }
        assert_eq!(trash_path(&f).unwrap_err(), "not found");
    }
}
