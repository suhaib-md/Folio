//! Path guards shared by the commands that touch the disk on the UI's behalf.

use std::path::Path;

/// True for `\\server\share`, `//server/share`, `\\?\` and `\\.\` forms:
/// paths that would make Windows open a network connection or a device.
pub fn is_remote_or_device(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.starts_with("\\\\") || s.starts_with("//")
}

/// An absolute, local path: not relative, not UNC/device, and on Windows
/// only a drive prefix (`C:\` or `\\?\C:\`).
pub fn is_plain_absolute(path: &Path) -> bool {
    if is_remote_or_device(path) || !path.is_absolute() {
        return false;
    }
    #[cfg(windows)]
    if let Some(std::path::Component::Prefix(p)) = path.components().next() {
        use std::path::Prefix;
        if !matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_and_device_paths_are_recognised() {
        for p in ["\\\\server\\share\\a.png", "\\\\?\\C:\\a.png", "\\\\.\\pipe\\a.png", "//server/share/a.png"] {
            assert!(is_remote_or_device(Path::new(p)), "{p}");
        }
        for p in ["C:\\a.png", "/home/a.png", "a.png"] {
            assert!(!is_remote_or_device(Path::new(p)), "{p}");
        }
    }

    #[test]
    fn plain_absolute_refuses_relative_and_unc() {
        for p in ["a.md", "x/a.md", "//server/share/a.md", "\\\\server\\share\\a.md"] {
            assert!(!is_plain_absolute(Path::new(p)), "{p}");
        }
        #[cfg(unix)]
        assert!(is_plain_absolute(Path::new("/home/a.md")));
        #[cfg(windows)]
        assert!(is_plain_absolute(Path::new("C:\\a.md")));
    }
}
