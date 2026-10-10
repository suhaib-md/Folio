//! Moving to the Recycle Bin / Trash. Its own test binary with ONE test, so
//! setting XDG_DATA_HOME cannot race any other test reading the environment.
//! Only files created in a temp dir are ever trashed (on Windows and macOS
//! they do land in the real Recycle Bin / Trash; they are throwaway files).

use std::fs;

use folio_core::fileops::trash_path;

#[test]
fn trash_removes_from_folder() {
    let d = tempfile::tempdir().unwrap();
    // The freedesktop trash lives under XDG_DATA_HOME; keep it on the same
    // file system as the files so the move is a rename.
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let data = d.path().join("xdg");
        // Skip only when a trash directory genuinely cannot be created here.
        if fs::create_dir_all(data.join("Trash/files")).is_err() {
            return;
        }
        std::env::set_var("XDG_DATA_HOME", &data);
    }
    let dir = d.path().join("proj");
    fs::create_dir(&dir).unwrap();
    let f = dir.join("gone.md");
    fs::write(&f, "x").unwrap();
    let sub = dir.join("sub");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("in.md"), "y").unwrap();

    trash_path(&f).unwrap();
    trash_path(&sub).unwrap();
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    assert_eq!(trash_path(&f).unwrap_err(), "not found");
}
