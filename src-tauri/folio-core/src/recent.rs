use serde::{Deserialize, Serialize};
use std::path::Path;

const MAX_FILES: usize = 10;
const MAX_FOLDERS: usize = 5;

fn same(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Folder,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recent {
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub folders: Vec<String>,
}

impl Recent {
    pub fn load(path: &Path) -> Recent {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| e.to_string())
    }

    pub fn add(&mut self, p: &str, kind: Kind) {
        let (list, cap) = match kind {
            Kind::File => (&mut self.files, MAX_FILES),
            Kind::Folder => (&mut self.folders, MAX_FOLDERS),
        };
        list.retain(|x| !same(x, p));
        list.insert(0, p.to_string());
        list.truncate(cap);
    }

    pub fn remove(&mut self, p: &str) {
        self.files.retain(|x| !same(x, p));
        self.folders.retain(|x| !same(x, p));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_caps_and_dedups() {
        let mut r = Recent::default();
        for i in 0..12 {
            r.add(&format!("C:\\X\\f{i}.md"), Kind::File);
        }
        assert_eq!(r.files.len(), 10);
        assert_eq!(r.files[0], "C:\\X\\f11.md");
        assert_eq!(r.files[9], "C:\\X\\f2.md");

        r.add("C:\\X\\a.md", Kind::File);
        r.add("c:\\x\\A.md", Kind::File);
        assert_eq!(r.files.len(), 10);
        assert_eq!(r.files[0], "c:\\x\\A.md");
        assert_eq!(r.files.iter().filter(|f| f.to_lowercase() == "c:\\x\\a.md").count(), 1);

        for i in 0..7 {
            r.add(&format!("C:\\D{i}"), Kind::Folder);
        }
        assert_eq!(r.folders.len(), 5);
        assert_eq!(r.folders[0], "C:\\D6");
    }

    #[test]
    fn recent_remove() {
        let mut r = Recent::default();
        r.add("C:\\a.md", Kind::File);
        r.add("C:\\d", Kind::Folder);
        r.remove("c:\\A.MD");
        r.remove("C:\\d");
        assert!(r.files.is_empty());
        assert!(r.folders.is_empty());
    }

    #[test]
    fn recent_load_corrupt_is_empty() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("recent.json");
        assert_eq!(Recent::load(&p), Recent::default());
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(Recent::load(&p), Recent::default());
    }

    #[test]
    fn recent_save_load_round_trip() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("sub").join("recent.json");
        let mut r = Recent::default();
        r.add("C:\\a.md", Kind::File);
        r.add("C:\\d", Kind::Folder);
        r.save(&p).unwrap();
        assert_eq!(Recent::load(&p), r);
    }
}
