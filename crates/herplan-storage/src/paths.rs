//! Validation of paths that come from the interface or from archives.
//!
//! The interface addresses files by relative paths such as `data/entities/<id>.json`. Every such
//! path is checked before it touches the disk, so a bug or a crafted archive cannot write outside
//! the project, into `backups/`, or create a name that Windows cannot open.

use std::path::{Component, Path, PathBuf};

use crate::atomic::is_temp_name;
use crate::error::{Result, StorageError};

pub const PROJECT_FILE: &str = "project.json";

/// The folder of the asset library: the user's own files, in folders of their own.
pub(crate) const ASSETS_DIR: &str = "assets";

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

/// Like [`validate_rel_path`], but for a file: a bare top-level folder (`data`, `assets`…) is
/// never read, written or deleted as a whole.
pub(crate) fn validate_file_path(rel: &str) -> Result<PathBuf> {
    let native = validate_rel_path(rel)?;
    if is_root_folder(&native) {
        return Err(StorageError::invalid_path(rel));
    }
    Ok(native)
}

/// Like [`validate_rel_path`], but only for what lies inside `assets/`: the asset library cannot
/// reach project data. Temporary files of interrupted writes cannot be addressed either. The bare
/// `assets` folder is accepted only with `root_ok`, as a destination folder.
pub(crate) fn validate_asset_path(rel: &str, root_ok: bool) -> Result<PathBuf> {
    let segments = segments(rel).ok_or_else(|| StorageError::invalid_path(rel))?;
    let allowed = match segments.split_first() {
        Some((root, rest)) if *root == ASSETS_DIR => {
            (root_ok || !rest.is_empty()) && !rest.iter().any(|s| is_temp_name(s))
        }
        _ => false,
    };
    if !allowed {
        return Err(StorageError::invalid_path(rel));
    }
    Ok(segments.iter().collect())
}

/// A name for a new file or folder: a single valid segment, not a temporary file's name.
pub(crate) fn is_valid_name(name: &str) -> bool {
    !name.contains(['/', '\\']) && is_valid_segment(name) && !is_temp_name(name)
}

fn is_root_folder(rel: &Path) -> bool {
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
    fn file_paths_exclude_bare_roots() {
        for root in ["data", "documents", "assets", ".herplan"] {
            assert!(validate_rel_path(root).is_ok(), "{root} as a folder");
            let err = validate_file_path(root).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidPath, "{root} as a file");
        }
        assert!(validate_file_path("project.json").is_ok());
        assert!(validate_file_path("assets/a.png").is_ok());
    }

    #[test]
    fn asset_paths_stay_inside_assets() {
        for path in [
            "assets/a.png",
            "assets/Мир/Персонажи/Мира.png",
            "assets\\a\\b.png",
        ] {
            assert!(validate_asset_path(path, false).is_ok(), "{path}");
        }
        assert_eq!(
            validate_asset_path("assets\\a/b.png", false).unwrap(),
            Path::new("assets").join("a").join("b.png")
        );
        assert_eq!(
            validate_asset_path("assets", true).unwrap(),
            Path::new("assets")
        );
        let bad = [
            "assets",
            "",
            "Assets/a.png",
            "assets/../project.json",
            "assets/a/../../data/x.json",
            "assets/./a.png",
            "assets//a.png",
            "assets/",
            "/assets/a.png",
            "C:\\p\\assets\\a.png",
            "data/entities/a.json",
            "documents/a.md",
            ".herplan/workspace.json",
            "backups/auto/x.zip",
            "project.json",
            "assets/.a.png.tmp-12",
            "assets/.folder.tmp-3/a.png",
            "assets/con.png",
            "assets/a?.png",
        ];
        for path in bad {
            let err = validate_asset_path(path, false).expect_err(path);
            assert_eq!(err.code, ErrorCode::InvalidPath, "{path}");
        }
        for path in ["data", "../assets", "assets/..", "backups", ""] {
            assert!(validate_asset_path(path, true).is_err(), "{path}");
        }
    }

    #[test]
    fn checks_new_names() {
        for name in ["a.png", "Скриншот 2026-10-20.png", ".hidden", "a (2).png"] {
            assert!(is_valid_name(name), "{name}");
        }
        let bad = [
            "",
            ".",
            "..",
            "a/b.png",
            "a\\b.png",
            "a:b.png",
            "con",
            "name.",
            "name ",
            ".a.png.tmp-1",
        ];
        for name in bad {
            assert!(!is_valid_name(name), "{name}");
        }
    }

    #[test]
    fn requires_absolute_folders() {
        assert!(require_absolute("").is_err());
        assert!(require_absolute("relative/dir").is_err());
        let abs = std::env::temp_dir();
        assert!(require_absolute(abs.to_str().unwrap()).is_ok());
    }
}
