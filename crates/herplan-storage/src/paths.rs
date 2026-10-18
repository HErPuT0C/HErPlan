//! Validation of paths that come from the interface or from archives.
//!
//! The interface addresses files by relative paths such as `data/entities/<id>.json`. Every such
//! path is checked before it touches the disk, so a bug or a crafted archive cannot write outside
//! the project, into `backups/`, or create a name that Windows cannot open.

use std::path::{Component, Path, PathBuf};

use crate::error::{Result, StorageError};

pub const PROJECT_FILE: &str = "project.json";

/// Top-level folders the interface may write into.
const WRITABLE_ROOTS: &[&str] = &["data", "documents", "assets", ".herplan"];

const WINDOWS_INVALID: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

/// Checks a project-relative path and turns it into a native relative path.
///
/// Accepts `/` and `\` as separators. The path must be `project.json` or lie in `data/`,
/// `documents/`, `assets/` or `.herplan/` (a bare root such as `assets` is accepted, for use as a
/// destination folder).
pub fn validate_rel_path(rel: &str) -> Result<PathBuf> {
    let segments = segments(rel).ok_or_else(|| StorageError::invalid_path(rel))?;
    let allowed = match segments.as_slice() {
        [single] => *single == PROJECT_FILE || WRITABLE_ROOTS.contains(single),
        [root, ..] => WRITABLE_ROOTS.contains(root),
        [] => false,
    };
    if !allowed {
        return Err(StorageError::invalid_path(rel));
    }
    Ok(segments.iter().collect())
}

/// True for a bare top-level folder (`data`, `assets`…): those are never written or deleted as a whole.
pub(crate) fn is_root_folder(rel: &Path) -> bool {
    let mut components = rel.components();
    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(name)), None) if name != PROJECT_FILE
    )
}

/// Splits a relative path into segments, or returns `None` if any segment is unsafe.
/// Used for both interface paths and archive entry names.
pub(crate) fn segments(rel: &str) -> Option<Vec<&str>> {
    if rel.is_empty() || rel.starts_with(['/', '\\']) {
        return None;
    }
    let segments: Vec<&str> = rel.split(['/', '\\']).collect();
    segments
        .iter()
        .all(|s| is_valid_segment(s))
        .then_some(segments)
}

/// One file or folder name that is safe on Windows and cannot escape its parent.
pub(crate) fn is_valid_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && !segment
            .chars()
            .any(|c| c.is_control() || WINDOWS_INVALID.contains(&c))
        && !segment.ends_with(['.', ' '])
        && !is_reserved_name(segment)
}

/// Device names that Windows reserves in every folder, with or without an extension.
fn is_reserved_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or_default();
    let stem = stem.trim_end_matches(' ').to_ascii_uppercase();
    matches!(
        stem.as_bytes(),
        b"CON"
            | b"PRN"
            | b"AUX"
            | b"NUL"
            | [b'C', b'O', b'M', b'1'..=b'9']
            | [b'L', b'P', b'T', b'1'..=b'9']
    )
}

/// Folder paths from the interface must be absolute: a relative one would depend on the
/// process working directory.
pub fn require_absolute(path: &str) -> Result<PathBuf> {
    let path_buf = PathBuf::from(path);
    if path.is_empty() || !path_buf.is_absolute() {
        return Err(StorageError::invalid_path(path));
    }
    Ok(path_buf)
}

/// A relative native path written with forward slashes, as the interface expects.
pub(crate) fn to_slash(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn accepts_project_paths() {
        let ok = [
            "project.json",
            "data/types.json",
            "data/entities/k3v9q0d2m7x1c8bz.json",
            "documents/Мир/Диздок.md",
            "documents\\Мир\\Диздок.md",
            "assets/cover.png",
            "assets/my file (2).png",
            ".herplan/workspace.json",
            "assets",
            "documents/con-notes.md",
            "documents/COM10.md",
            "documents/.hidden.md",
        ];
        for path in ok {
            assert!(validate_rel_path(path).is_ok(), "{path} should be accepted");
        }
        let native = validate_rel_path("documents\\a/b.md").unwrap();
        assert_eq!(native, Path::new("documents").join("a").join("b.md"));
        assert_eq!(to_slash(&native), "documents/a/b.md");
    }

    #[test]
    fn rejects_unsafe_paths() {
        let bad = [
            "",
            "/etc/passwd",
            "\\data\\a.json",
            "\\\\server\\share\\a.json",
            "C:\\data\\a.json",
            "C:data/a.json",
            "data/../project.json",
            "data/./a.json",
            "..",
            "data//a.json",
            "data/",
            "data/a\0.json",
            "data/a\n.json",
            "data/a<b.json",
            "data/a>b.json",
            "data/a:b.json",
            "data/a\"b.json",
            "data/a|b.json",
            "data/a?b.json",
            "data/a*b.json",
            "documents/name.",
            "documents/name ",
            "documents/CON",
            "documents/con.md",
            "documents/Nul.txt",
            "documents/aux .md",
            "documents/COM1.md",
            "documents/lpt9",
            "documents/prn/a.md",
            "backups/auto/x.zip",
            "backups",
            "other/a.json",
            "project.json/x",
            "Project.json",
            "a.json",
        ];
        for path in bad {
            let err = validate_rel_path(path).expect_err(path);
            assert_eq!(err.code, ErrorCode::InvalidPath, "{path}");
            assert_eq!(err.path.as_deref(), Some(path));
        }
    }

    #[test]
    fn recognises_root_folders() {
        assert!(is_root_folder(Path::new("assets")));
        assert!(!is_root_folder(Path::new("project.json")));
        assert!(!is_root_folder(&Path::new("assets").join("a.png")));
    }

    #[test]
    fn requires_absolute_folders() {
        assert!(require_absolute("").is_err());
        assert!(require_absolute("relative/dir").is_err());
        let abs = std::env::temp_dir();
        assert!(require_absolute(abs.to_str().unwrap()).is_ok());
    }
}
