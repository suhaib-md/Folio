use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    Lf,
    Crlf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub text: String,
    pub eol: Eol,
    pub bom: bool,
}

fn io_err(e: io::Error) -> String {
    match e.kind() {
        io::ErrorKind::PermissionDenied => "permission denied".to_string(),
        io::ErrorKind::NotFound => "file not found".to_string(),
        _ => e.to_string(),
    }
}

pub fn read_file(path: &Path) -> Result<ReadResult, String> {
    let bytes = fs::read(path).map_err(io_err)?;
    let (bom, body) = match bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        Some(rest) => (true, rest),
        None => (false, &bytes[..]),
    };
    let text = std::str::from_utf8(body).map_err(|_| "not UTF-8".to_string())?;
    if text.contains('\0') {
        return Err("file contains binary data".to_string());
    }
    let eol = if text.contains("\r\n") { Eol::Crlf } else { Eol::Lf };
    Ok(ReadResult { text: text.replace("\r\n", "\n"), eol, bom })
}

pub fn write_file(path: &Path, text: &str, eol: Eol, bom: bool) -> Result<(), String> {
    match fs::metadata(path) {
        Ok(m) if m.permissions().readonly() => return Err("file is read-only".to_string()),
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(io_err(e)),
    }

    let normalised = text.replace("\r\n", "\n");
    let body = match eol {
        Eol::Lf => normalised,
        Eol::Crlf => normalised.replace('\n', "\r\n"),
    };
    let mut bytes = Vec::with_capacity(body.len() + 3);
    if bom {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(body.as_bytes());

    crate::atomic::atomic_write(path, &bytes, false).map_err(io_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn no_tmp_left(dir: &Path) -> bool {
        fs::read_dir(dir)
            .unwrap()
            .all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".folio-tmp"))
    }

    #[test]
    fn read_crlf_normalises() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        fs::write(&p, "a\r\nb\r\n").unwrap();
        let r = read_file(&p).unwrap();
        assert_eq!(r.text, "a\nb\n");
        assert_eq!(r.eol, Eol::Crlf);
        assert!(!r.bom);
    }

    #[test]
    fn read_lf() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        fs::write(&p, "a\nb").unwrap();
        assert_eq!(read_file(&p).unwrap().eol, Eol::Lf);
    }

    #[test]
    fn read_bom_stripped() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        let mut b = vec![0xEF, 0xBB, 0xBF];
        b.extend_from_slice(b"# T");
        fs::write(&p, b).unwrap();
        let r = read_file(&p).unwrap();
        assert_eq!(r.text, "# T");
        assert!(r.bom);
    }

    #[test]
    fn read_rejects_non_utf8() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        fs::write(&p, [0xff, 0xfe, 0x41]).unwrap();
        assert!(read_file(&p).is_err());
    }

    #[test]
    fn read_rejects_nul() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        fs::write(&p, "a\0b").unwrap();
        assert!(read_file(&p).is_err());
    }

    #[test]
    fn write_round_trip_crlf_bom() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        write_file(&p, "a\nb\n", Eol::Crlf, true).unwrap();
        assert_eq!(
            fs::read(&p).unwrap(),
            vec![0xEF, 0xBB, 0xBF, 0x61, 0x0D, 0x0A, 0x62, 0x0D, 0x0A]
        );
        let r = read_file(&p).unwrap();
        assert_eq!(r.text, "a\nb\n");
        assert_eq!(r.eol, Eol::Crlf);
        assert!(r.bom);
    }

    #[test]
    fn write_replaces_and_leaves_no_temp() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        fs::write(&p, "old").unwrap();
        write_file(&p, "new", Eol::Lf, false).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "new");
        assert!(no_tmp_left(d.path()));
    }

    #[test]
    fn write_readonly_fails_cleanly() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        fs::write(&p, "orig").unwrap();
        let mut perms = fs::metadata(&p).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&p, perms).unwrap();

        let res = write_file(&p, "changed", Eol::Lf, false);

        // Restore write permission so tempdir cleanup works.
        let mut perms = fs::metadata(&p).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&p, perms).unwrap();

        assert!(res.is_err());
        assert_eq!(fs::read_to_string(&p).unwrap(), "orig");
        assert!(no_tmp_left(d.path()));
    }
}
