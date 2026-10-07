use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<TreeNode>>,
}

fn is_markdown(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Walks `dir` depth-first. Returns the included children; sets `truncated`
/// once a file beyond `limit` is found, after which the walk stops.
fn walk(dir: &Path, limit: usize, count: &mut usize, truncated: &mut bool) -> Vec<TreeNode> {
    let mut dirs: Vec<(String, std::path::PathBuf)> = Vec::new();
    let mut files: Vec<(String, std::path::PathBuf)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(ft) = entry.file_type() else { continue };
            let path = entry.path();
            if ft.is_dir() {
                if !skip_dir(&name) {
                    dirs.push((name, path));
                }
            } else if is_markdown(&name) && (ft.is_file() || path.is_file()) {
                files.push((name, path));
            }
        }
    }
    let key = |a: &(String, std::path::PathBuf)| (a.0.to_lowercase(), a.0.clone());
    dirs.sort_by_key(key);
    files.sort_by_key(key);

    let mut out = Vec::new();
    for (name, path) in dirs {
        if *truncated {
            break;
        }
        let children = walk(&path, limit, count, truncated);
        if !children.is_empty() {
            out.push(TreeNode {
                name,
                path: path.to_string_lossy().into_owned(),
                kind: "dir",
                children: Some(children),
            });
        }
    }
    for (name, path) in files {
        if *truncated {
            break;
        }
        if *count >= limit {
            *truncated = true;
            break;
        }
        *count += 1;
        out.push(TreeNode {
            name,
            path: path.to_string_lossy().into_owned(),
            kind: "file",
            children: None,
        });
    }
    out
}

pub fn list_tree(root: &Path, limit: usize) -> Result<(TreeNode, bool), String> {
    let meta = std::fs::metadata(root).map_err(|e| match e.kind() {
        std::io::ErrorKind::PermissionDenied => "permission denied".to_string(),
        std::io::ErrorKind::NotFound => "folder not found".to_string(),
        _ => e.to_string(),
    })?;
    if !meta.is_dir() {
        return Err("not a folder".to_string());
    }
    let mut count = 0;
    let mut truncated = false;
    let children = walk(root, limit, &mut count, &mut truncated);
    Ok((
        TreeNode {
            name: name_of(root),
            path: root.to_string_lossy().into_owned(),
            kind: "dir",
            children: Some(children),
        },
        truncated,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(p: &Path) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, "x").unwrap();
    }

    #[test]
    fn tree_filters_and_sorts() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        fs::create_dir(r.join("b")).unwrap();
        touch(&r.join("A/x.md"));
        touch(&r.join(".git/y.md"));
        touch(&r.join("node_modules/z.md"));
        fs::create_dir(r.join("empty")).unwrap();
        touch(&r.join("c.MD"));
        touch(&r.join("a.markdown"));
        touch(&r.join("n.txt"));

        let (root, truncated) = list_tree(r, 100).unwrap();
        assert!(!truncated);
        assert_eq!(root.kind, "dir");
        let kids = root.children.unwrap();
        let got: Vec<(&str, &str)> = kids.iter().map(|n| (n.name.as_str(), n.kind)).collect();
        assert_eq!(got, vec![("A", "dir"), ("a.markdown", "file"), ("c.MD", "file")]);
        let a = kids[0].children.as_ref().unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].name, "x.md");
        assert_eq!(a[0].path, r.join("A").join("x.md").to_string_lossy());
        assert!(kids[1].children.is_none());
    }

    #[test]
    fn tree_truncates() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..10 {
            touch(&d.path().join(format!("f{i}.md")));
        }
        let (root, truncated) = list_tree(d.path(), 3).unwrap();
        assert!(truncated);
        let kids = root.children.unwrap();
        assert_eq!(kids.len(), 3);
        assert!(kids.iter().all(|n| n.kind == "file"));
    }

    #[test]
    fn tree_serialises_without_null_children() {
        let d = tempfile::tempdir().unwrap();
        touch(&d.path().join("a.md"));
        let (root, _) = list_tree(d.path(), 10).unwrap();
        let v = serde_json::to_value(&root).unwrap();
        assert_eq!(v["kind"], "dir");
        assert!(v["children"][0].get("children").is_none());
    }
}
