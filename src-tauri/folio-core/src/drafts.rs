//! Crash-recovery drafts: one `<id>.json` per unsaved tab in a directory.
//! Writes are atomic (temp file + rename); a corrupt file is skipped, never
//! fatal, so one bad draft can't block the others from being restored.

use crate::files::Eol;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub path: Option<String>,
    pub title: String,
    pub text: String,
    pub eol: Eol,
    pub bom: bool,
    /// The tab's saved text when the draft was written (None: untitled).
    pub base_text: Option<String>,
    /// Milliseconds since the epoch.
    pub saved_at: u64,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn check_id(id: &str) -> Result<(), String> {
    if valid_id(id) {
        Ok(())
    } else {
        Err("invalid draft id".to_string())
    }
}

fn file_of(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

/// Every readable draft, oldest `saved_at` first (the restore order).
pub fn list(dir: &Path) -> Vec<Draft> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut drafts: Vec<Draft> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                return None;
            }
            let stem = path.file_stem()?.to_str()?.to_string();
            let draft: Draft = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
            // The name is the id: a mismatch can't be deleted later.
            (draft.id == stem && valid_id(&stem)).then_some(draft)
        })
        .collect();
    drafts.sort_by(|a, b| a.saved_at.cmp(&b.saved_at).then_with(|| a.id.cmp(&b.id)));
    drafts
}

pub fn save(dir: &Path, draft: &Draft) -> Result<(), String> {
    check_id(&draft.id)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec(draft).map_err(|e| e.to_string())?;
    let target = file_of(dir, &draft.id);
    let tmp = dir.join(format!("{}.json.tmp", draft.id));
    let result = fs::write(&tmp, &json).and_then(|_| fs::rename(&tmp, &target));
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

/// Deleting a draft that doesn't exist is fine.
pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    check_id(id)?;
    match fs::remove_file(file_of(dir, id)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(id: &str, saved_at: u64) -> Draft {
        Draft {
            id: id.to_string(),
            path: Some("C:\\x\\a.md".to_string()),
            title: "a.md".to_string(),
            text: "héllo\r\nwörld \u{1F600}".to_string(),
            eol: Eol::Crlf,
            bom: true,
            base_text: Some("base".to_string()),
            saved_at,
        }
    }

    #[test]
    fn round_trip() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("drafts");
        let mut a = draft("lx1-t1", 20);
        let mut b = draft("lx1-t2", 10);
        b.path = None;
        b.base_text = None;
        save(&dir, &a).unwrap();
        save(&dir, &b).unwrap();
        a.text = "newer".to_string();
        save(&dir, &a).unwrap(); // overwrite
        assert_eq!(list(&dir), vec![b, a]); // oldest first
        let leftovers = fs::read_dir(&dir).unwrap().filter(|e| {
            e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp")
        });
        assert_eq!(leftovers.count(), 0);
    }

    #[test]
    fn json_is_camel_case() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), &draft("a", 1)).unwrap();
        let s = fs::read_to_string(d.path().join("a.json")).unwrap();
        assert!(s.contains("\"baseText\"") && s.contains("\"savedAt\"") && s.contains("\"crlf\""));
    }

    #[test]
    fn corrupt_skipped() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), &draft("good", 1)).unwrap();
        fs::write(d.path().join("bad.json"), "{not json").unwrap();
        fs::write(d.path().join("empty.json"), "").unwrap();
        fs::write(d.path().join("note.txt"), "x").unwrap();
        // valid JSON whose id doesn't match its file name
        let mut other = draft("other", 2);
        other.id = "liar".to_string();
        fs::write(d.path().join("other.json"), serde_json::to_vec(&other).unwrap()).unwrap();
        let got = list(d.path());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "good");
        assert!(list(&d.path().join("missing")).is_empty());
    }

    #[test]
    fn bad_id_rejected() {
        let d = tempfile::tempdir().unwrap();
        for id in ["", "../x", "a/b", "a\\b", "a.b", "a b", "é"] {
            assert!(save(d.path(), &draft(id, 1)).is_err(), "save {id:?}");
            assert!(delete(d.path(), id).is_err(), "delete {id:?}");
        }
        assert_eq!(fs::read_dir(d.path()).unwrap().count(), 0);
    }

    #[test]
    fn delete_missing_ok() {
        let d = tempfile::tempdir().unwrap();
        delete(d.path(), "nope").unwrap();
        delete(&d.path().join("no-dir"), "nope").unwrap();
        save(d.path(), &draft("x", 1)).unwrap();
        delete(d.path(), "x").unwrap();
        assert!(list(d.path()).is_empty());
    }
}
