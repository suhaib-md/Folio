//! App settings (`settings.json` in the app config dir). Every field has a
//! default, unknown fields are ignored, and a missing or corrupt file means
//! defaults, so an old or hand-edited file never stops the app starting.
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Sidebar {
    pub visible: bool,
    pub tab: String,
}

impl Default for Sidebar {
    fn default() -> Self {
        Sidebar { visible: true, tab: "files".into() }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionTab {
    pub path: String,
    #[serde(default)]
    pub mode: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Session {
    pub tabs: Vec<SessionTab>,
    pub active: Option<String>,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub zoom: u32,
    pub theme: String,
    pub autosave: bool,
    pub sidebar: Sidebar,
    pub session: Session,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            zoom: 100,
            theme: "system".into(),
            autosave: false,
            sidebar: Sidebar::default(),
            session: Session::default(),
        }
    }
}

pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    crate::atomic::atomic_write(path, json.as_bytes(), false).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("folio-settings-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("settings.json")
    }

    #[test]
    fn defaults_when_missing() {
        let p = tmp("missing");
        assert_eq!(load(&p), Settings::default());
        assert_eq!(Settings::default().zoom, 100);
        assert_eq!(Settings::default().sidebar.tab, "files");
    }

    #[test]
    fn defaults_when_corrupt() {
        let p = tmp("corrupt");
        std::fs::write(&p, "{ not json").unwrap();
        assert_eq!(load(&p), Settings::default());
    }

    #[test]
    fn partial_json_fills_defaults() {
        let p = tmp("partial");
        std::fs::write(
            &p,
            r#"{"autosave": true, "future": 1, "sidebar": {"tab": "outline"}, "session": {"active": "/a.md"}}"#,
        )
        .unwrap();
        let s = load(&p);
        assert!(s.autosave);
        assert_eq!(s.zoom, 100);
        assert_eq!(s.theme, "system");
        assert!(s.sidebar.visible);
        assert_eq!(s.sidebar.tab, "outline");
        assert_eq!(s.session.active.as_deref(), Some("/a.md"));
        assert!(s.session.tabs.is_empty());
    }

    #[test]
    fn round_trip() {
        let p = tmp("rt");
        let mut s = Settings::default();
        s.zoom = 120;
        s.theme = "dark".into();
        s.autosave = true;
        s.session.tabs.push(SessionTab { path: "/a.md".into(), mode: "edit".into() });
        s.session.folder = Some("/x".into());
        save(&p, &s).unwrap();
        assert_eq!(load(&p), s);
    }
}
