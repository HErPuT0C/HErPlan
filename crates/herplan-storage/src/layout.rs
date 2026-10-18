//! The project folder layout (docs/format/project-v1.md) and project creation.

use std::fs;
use std::path::Path;

use crate::error::{AtPath, ErrorCode, Result, StorageError};
use crate::model::{FileText, PathStatus};
use crate::paths::PROJECT_FILE;
use crate::write::write_files;

/// Folders every project has, even when empty.
pub const LAYOUT_DIRS: &[&str] = &[
    "data/entities",
    "data/graphs",
    "data/boards",
    "documents",
    "assets",
    "backups/auto",
    "backups/manual",
    ".herplan",
];

/// Creates any missing layout folder. Projects copied by hand or unpacked from an archive may
/// lack empty folders, since git and many zip tools drop them.
pub fn ensure_layout(dir: &Path) -> Result<()> {
    for sub in LAYOUT_DIRS {
        let path = dir.join(sub);
        fs::create_dir_all(&path).at(&path)?;
    }
    Ok(())
}

/// What is at `path`, so the interface can tell whether a project can be created there.
pub fn path_status(path: &Path) -> Result<PathStatus> {
    let meta = match fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(PathStatus::Missing),
        Err(e) => return Err(StorageError::io(&e, path)),
    };
    if !meta.is_dir() {
        return Ok(PathStatus::File);
    }
    let mut entries = fs::read_dir(path).at(path)?;
    Ok(match entries.next() {
        None => PathStatus::EmptyDir,
        Some(_) => PathStatus::NonEmptyDir,
    })
}

/// Fails unless `dir` can receive a new project: it must be missing or an empty folder.
pub(crate) fn check_new_project_dir(dir: &Path) -> Result<()> {
    match path_status(dir)? {
        PathStatus::Missing | PathStatus::EmptyDir => Ok(()),
        PathStatus::NonEmptyDir => Err(StorageError::new(
            ErrorCode::NotEmpty,
            "the folder is not empty",
            Some(dir),
        )),
        PathStatus::File => Err(StorageError::new(
            ErrorCode::Exists,
            "a file with this name exists",
            Some(dir),
        )),
    }
}

/// Fails unless `dir` holds a project (a `project.json`).
pub(crate) fn require_project(dir: &Path) -> Result<()> {
    let meta = fs::metadata(dir).at(dir)?;
    if meta.is_dir() && dir.join(PROJECT_FILE).is_file() {
        Ok(())
    } else {
        Err(StorageError::not_a_project(dir))
    }
}

/// Creates the project folder with its layout and writes the initial files.
pub fn create_project(dir: &Path, files: &[FileText]) -> Result<()> {
    check_new_project_dir(dir)?;
    // Validate before creating anything, so a bad path leaves no half-made project.
    let files = crate::write::validate_writes(files)?;
    fs::create_dir_all(dir).at(dir)?;
    ensure_layout(dir)?;
    write_files(dir, &files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, text: &str) -> FileText {
        FileText {
            path: path.into(),
            text: text.into(),
        }
    }

    #[test]
    fn reports_path_status() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        assert_eq!(path_status(&root.join("x")).unwrap(), PathStatus::Missing);
        assert_eq!(path_status(root).unwrap(), PathStatus::EmptyDir);
        fs::write(root.join("f"), "x").unwrap();
        assert_eq!(path_status(root).unwrap(), PathStatus::NonEmptyDir);
        assert_eq!(path_status(&root.join("f")).unwrap(), PathStatus::File);
    }

    #[test]
    fn creates_layout_and_files() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Мельница");
        create_project(
            &dir,
            &[
                file("project.json", "{\"name\":\"Мельница\"}\n"),
                file("data/types.json", "{}\n"),
                file("documents/Мир/Диздок.md", "# Диздок\n"),
            ],
        )
        .unwrap();
        for sub in LAYOUT_DIRS {
            assert!(dir.join(sub).is_dir(), "{sub}");
        }
        assert_eq!(
            fs::read_to_string(dir.join("project.json")).unwrap(),
            "{\"name\":\"Мельница\"}\n"
        );
        assert!(dir.join("documents/Мир/Диздок.md").is_file());
    }

    #[test]
    fn creates_into_an_empty_folder() {
        let tmp = tempfile::tempdir().unwrap();
        create_project(tmp.path(), &[file("project.json", "{}")]).unwrap();
        assert!(tmp.path().join("project.json").is_file());
    }

    #[test]
    fn refuses_occupied_targets() {
        let tmp = tempfile::tempdir().unwrap();
        let occupied = tmp.path().join("occupied");
        fs::create_dir(&occupied).unwrap();
        fs::write(occupied.join("x.txt"), "x").unwrap();
        let err = create_project(&occupied, &[]).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotEmpty);

        let a_file = tmp.path().join("file");
        fs::write(&a_file, "x").unwrap();
        let err = create_project(&a_file, &[]).unwrap_err();
        assert_eq!(err.code, ErrorCode::Exists);
    }

    #[test]
    fn rejects_bad_paths_before_creating_anything() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("p");
        let err = create_project(&dir, &[file("../evil.json", "{}")]).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidPath);
        assert!(!dir.exists());
    }
}
