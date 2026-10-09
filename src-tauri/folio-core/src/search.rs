use crate::{files, tree};
use serde::Serialize;
use std::path::Path;

const WINDOW: usize = 200;
const LEAD: usize = 60;
const CANCEL_EVERY_LINES: usize = 1000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    /// 1-based line number.
    pub line: usize,
    /// The line, or a 200-char window of it containing the match.
    pub text: String,
    /// Char offsets of the match into `text`.
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMatches {
    pub path: String,
    pub matches: Vec<LineMatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub files: Vec<FileMatches>,
    pub truncated: bool,
}

/// Simple per-char lowercase; chars whose lowercase is not a single char
/// (e.g. 'İ') are kept as they are so char offsets stay aligned.
fn fold(c: char) -> char {
    let mut it = c.to_lowercase();
    match (it.next(), it.next()) {
        (Some(l), None) => l,
        _ => c,
    }
}

fn line_matches(
    line_no: usize,
    line: &str,
    query: &[char],
    match_case: bool,
    out: &mut Vec<LineMatch>,
    limit: usize,
    total: &mut usize,
) -> bool {
    let chars: Vec<char> = line.trim_end_matches('\r').chars().collect();
    let q = query.len();
    if chars.len() < q {
        return false;
    }
    let hay: Vec<char> = if match_case {
        Vec::new()
    } else {
        chars.iter().map(|&c| fold(c)).collect()
    };
    let hay = if match_case { &chars } else { &hay };
    let mut i = 0;
    while i + q <= hay.len() {
        if hay[i..i + q] != *query {
            i += 1;
            continue;
        }
        if *total >= limit {
            return true;
        }
        *total += 1;
        let (ws, we) = if chars.len() <= WINDOW {
            (0, chars.len())
        } else {
            let ws = if q >= WINDOW {
                i
            } else {
                i.saturating_sub(LEAD)
                    .max((i + q).saturating_sub(WINDOW))
                    .min(chars.len() - WINDOW)
            };
            (ws, (ws + WINDOW).min(chars.len()))
        };
        out.push(LineMatch {
            line: line_no,
            text: chars[ws..we].iter().collect(),
            start: i - ws,
            end: (i + q - ws).min(we - ws),
        });
        i += q;
    }
    false
}

struct Ctx<'a> {
    query: Vec<char>,
    match_case: bool,
    limit: usize,
    total: usize,
    truncated: bool,
    files: Vec<FileMatches>,
    cancel: &'a dyn Fn() -> bool,
}

impl Ctx<'_> {
    fn check(&self) -> Result<(), String> {
        if (self.cancel)() {
            Err("cancelled".to_string())
        } else {
            Ok(())
        }
    }

    fn search_file(&mut self, path: &Path) -> Result<(), String> {
        self.check()?;
        let Ok(read) = files::read_file(path) else {
            return Ok(());
        };
        let mut matches = Vec::new();
        for (idx, line) in read.text.split('\n').enumerate() {
            if idx % CANCEL_EVERY_LINES == CANCEL_EVERY_LINES - 1 {
                self.check()?;
            }
            if line_matches(
                idx + 1,
                line,
                &self.query,
                self.match_case,
                &mut matches,
                self.limit,
                &mut self.total,
            ) {
                self.truncated = true;
                break;
            }
        }
        if !matches.is_empty() {
            self.files.push(FileMatches {
                path: path.to_string_lossy().into_owned(),
                matches,
            });
        }
        Ok(())
    }

    fn walk(&mut self, dir: &Path) -> Result<(), String> {
        let (dirs, files) = tree::list_dir(dir);
        for (_, p) in dirs {
            if self.truncated {
                return Ok(());
            }
            self.walk(&p)?;
        }
        for (_, p) in files {
            if self.truncated {
                return Ok(());
            }
            self.search_file(&p)?;
        }
        Ok(())
    }
}

pub fn search_folder(
    root: &Path,
    query: &str,
    match_case: bool,
    limit: usize,
    cancel: &dyn Fn() -> bool,
) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult { files: Vec::new(), truncated: false });
    }
    let query: Vec<char> = if match_case {
        query.chars().collect()
    } else {
        query.chars().map(fold).collect()
    };
    let mut ctx = Ctx {
        query,
        match_case,
        limit,
        total: 0,
        truncated: false,
        files: Vec::new(),
        cancel,
    };
    ctx.walk(root)?;
    Ok(SearchResult { files: ctx.files, truncated: ctx.truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::fs;

    fn never() -> bool {
        false
    }

    fn put(p: &Path, text: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    #[test]
    fn finds_lines_with_1_based_numbers_and_char_offsets() {
        let d = tempfile::tempdir().unwrap();
        put(&d.path().join("a.md"), "nothing\nÜnï foo bar\r\nfoo foo\n");
        let r = search_folder(d.path(), "foo", true, 100, &never).unwrap();
        assert!(!r.truncated);
        assert_eq!(r.files.len(), 1);
        let m = &r.files[0].matches;
        assert_eq!(m.len(), 3);
        assert_eq!((m[0].line, m[0].text.as_str(), m[0].start, m[0].end), (2, "Ünï foo bar", 4, 7));
        assert_eq!((m[1].line, m[1].start, m[1].end), (3, 0, 3));
        assert_eq!((m[2].line, m[2].start, m[2].end), (3, 4, 7));
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["files"][0]["matches"][0]["line"], 2);
    }

    #[test]
    fn case_rules() {
        let d = tempfile::tempdir().unwrap();
        put(&d.path().join("a.md"), "Hello ÉCOLE\nhello école\n");
        let ci = search_folder(d.path(), "HELLO école", false, 100, &never).unwrap();
        assert_eq!(ci.files[0].matches.len(), 2);
        let cs = search_folder(d.path(), "Hello", true, 100, &never).unwrap();
        assert_eq!(cs.files[0].matches.len(), 1);
        assert_eq!(cs.files[0].matches[0].line, 1);
        let none = search_folder(d.path(), "", true, 100, &never).unwrap();
        assert!(none.files.is_empty() && !none.truncated);
    }

    #[test]
    fn skips_dot_dirs_node_modules_and_non_md() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        put(&r.join("b.md"), "needle");
        put(&r.join("A/x.markdown"), "needle");
        put(&r.join(".git/y.md"), "needle");
        put(&r.join("node_modules/z.md"), "needle");
        put(&r.join("n.txt"), "needle");
        put(&r.join(".h.md"), "needle");
        fs::write(r.join("bin.md"), b"needle\0").unwrap();
        fs::write(r.join("bad.md"), b"needle \xff").unwrap();
        let res = search_folder(r, "needle", true, 100, &never).unwrap();
        let paths: Vec<_> = res.files.iter().map(|f| f.path.clone()).collect();
        assert_eq!(
            paths,
            vec![
                r.join("A").join("x.markdown").to_string_lossy().into_owned(),
                r.join("b.md").to_string_lossy().into_owned()
            ]
        );
    }

    #[test]
    fn caps_at_limit_and_sets_truncated() {
        let d = tempfile::tempdir().unwrap();
        put(&d.path().join("a.md"), "x x x x x\nx\n");
        put(&d.path().join("b.md"), "x\n");
        let r = search_folder(d.path(), "x", true, 3, &never).unwrap();
        assert!(r.truncated);
        assert_eq!(r.files.len(), 1);
        assert_eq!(r.files[0].matches.len(), 3);
        let exact = search_folder(d.path(), "x", true, 7, &never).unwrap();
        assert!(!exact.truncated);
        assert_eq!(exact.files.iter().map(|f| f.matches.len()).sum::<usize>(), 7);
    }

    #[test]
    fn long_line_windowed_to_200_chars_around_match() {
        let d = tempfile::tempdir().unwrap();
        let line = format!("{}NEEDLE{}", "é".repeat(500), "z".repeat(500));
        put(&d.path().join("a.md"), &line);
        let r = search_folder(d.path(), "needle", false, 10, &never).unwrap();
        let m = &r.files[0].matches[0];
        assert_eq!(m.text.chars().count(), 200);
        assert_eq!((m.start, m.end), (60, 66));
        assert_eq!(&m.text.chars().skip(60).take(6).collect::<String>(), "NEEDLE");

        // Near the start and the end the window is clamped.
        put(&d.path().join("b.md"), &format!("hit{}", "y".repeat(400)));
        put(&d.path().join("c.md"), &format!("{}hit", "y".repeat(400)));
        let r = search_folder(d.path(), "hit", true, 10, &never).unwrap();
        let b = &r.files[0].matches[0];
        assert_eq!((b.text.chars().count(), b.start, b.end), (200, 0, 3));
        let c = &r.files[1].matches[0];
        assert_eq!((c.text.chars().count(), c.start, c.end), (200, 197, 200));

        // A match longer than the window starts the window and is clamped.
        put(&d.path().join("d.md"), &format!("pre{}post", "q".repeat(300)));
        let r = search_folder(d.path(), &"q".repeat(250), true, 10, &never).unwrap();
        let m = &r.files.iter().find(|f| f.path.ends_with("d.md")).unwrap().matches[0];
        assert_eq!((m.text.chars().count(), m.start, m.end), (200, 0, 200));
    }

    #[test]
    fn cancel_stops_early() {
        let d = tempfile::tempdir().unwrap();
        for i in 0..5 {
            put(&d.path().join(format!("f{i}.md")), "hit\n");
        }
        let calls = Cell::new(0);
        let cancel = || {
            calls.set(calls.get() + 1);
            calls.get() > 2
        };
        let r = search_folder(d.path(), "hit", true, 100, &cancel);
        assert_eq!(r, Err("cancelled".to_string()));
        assert!(calls.get() <= 4);

        // Also checked every 1000 lines inside one big file.
        put(&d.path().join("big.md"), &"hit\n".repeat(5000));
        let calls = Cell::new(0);
        let cancel = || {
            calls.set(calls.get() + 1);
            calls.get() > 1
        };
        let one = tempfile::tempdir().unwrap();
        fs::copy(d.path().join("big.md"), one.path().join("big.md")).unwrap();
        assert_eq!(
            search_folder(one.path(), "hit", true, 100000, &cancel),
            Err("cancelled".to_string())
        );
        assert_eq!(calls.get(), 2);
    }
}
