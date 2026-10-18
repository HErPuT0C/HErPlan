//! Saving project files and copying outside files into a project.

use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use crate::atomic::{write_atomic, write_atomic_with};
use crate::error::{AtPath, ErrorCode, Result, StorageError};
use crate::model::FileText;
use crate::paths::{is_root_folder, is_valid_segment, to_slash, validate_rel_path, PROJECT_FILE};

/// Top-level folders whose subfolders belong to the user and disappear once emptied.
const USER_FOLDER_ROOTS: &[&str] = &["documents", "assets"];

/// A validated write: native relative path and content.
pub(crate) struct ValidWrite<'a> {
    rel: PathBuf,
    text: &'a str,
}

/// Checks every path of a batch; the bare top-level folders cannot be written as files.
pub(crate) fn validate_writes(files: &[FileText]) -> Result<Vec<ValidWrite<'_>>> {
    files
        .iter()
        .map(|f| {
            Ok(ValidWrite {
                rel: validate_file_path(&f.path)?,
                text: &f.text,
            })
        })
        .collect()
}

fn validate_file_path(rel: &str) -> Result<PathBuf> {
    let native = validate_rel_path(rel)?;
    if is_root_folder(&native) {
        return Err(StorageError::invalid_path(rel));
    }
    Ok(native)
}

/// Writes each file atomically, creating parent folders as needed.
pub(crate) fn write_files(dir: &Path, files: &[ValidWrite<'_>]) -> Result<()> {
    for file in files {
        let target = dir.join(&file.rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).at(parent)?;
        }
        write_atomic(&target, file.text.as_bytes()).at(&target)?;
    }
    Ok(())
}

/// Saves a batch: atomic writes first, then deletes. All paths are checked before the disk is
/// touched, so an invalid path rejects the whole batch.
pub fn write_project(dir: &Path, writes: &[FileText], deletes: &[String]) -> Result<()> {
    let writes = validate_writes(writes)?;
    let deletes = deletes
        .iter()
        .map(|d| validate_file_path(d))
        .collect::<Result<Vec<_>>>()?;
    // A vanished project folder (unplugged drive) must not be silently recreated by the writes.
    if !dir.is_dir() {
        return Err(StorageError::new(
            ErrorCode::NotFound,
            "the project folder does not exist",
            Some(dir),
        ));
    }
    write_files(dir, &writes)?;
    for rel in &deletes {
        delete(dir, rel)?;
    }
    Ok(())
}

fn delete(dir: &Path, rel: &Path) -> Result<()> {
    let target = dir.join(rel);
    let removed = match fs::symlink_metadata(&target) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => Err(e),
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(&target),
        Ok(_) => fs::remove_file(&target),
    };
    removed.at(&target)?;
    remove_empty_user_folders(dir, rel);
    Ok(())
}

/// Removes folders under `documents/` and `assets/` that the delete left empty, walking up from
/// the deleted path. The top-level folders themselves always stay.
fn remove_empty_user_folders(dir: &Path, rel: &Path) {
    let in_user_root = rel
        .components()
        .next()
        .is_some_and(|c| USER_FOLDER_ROOTS.iter().any(|r| c.as_os_str() == *r));
    if !in_user_root {
        return;
    }
    let mut current = rel.parent();
    while let Some(folder) = current {
        if folder.components().count() < 2 {
            break;
        }
        // remove_dir fails on a non-empty folder, which is where the walk stops.
        if fs::remove_dir(dir.join(folder)).is_err() {
            break;
        }
        current = folder.parent();
    }
}

/// Copies an outside file into `<dir>/<dest_dir>/`, keeping its name; on a clash the copy becomes
/// `name (2).ext`, `name (3).ext`… Returns the project-relative path of the copy.
pub fn import_file(dir: &Path, source: &Path, dest_dir: &str) -> Result<String> {
    let dest_rel = validate_rel_path(dest_dir)?;
    if dest_rel == Path::new(PROJECT_FILE) {
        return Err(StorageError::invalid_path(dest_dir));
    }
    let meta = fs::metadata(source).at(source)?;
    if !meta.is_file() {
        return Err(StorageError::new(
            ErrorCode::NotFound,
            "not a file",
            Some(source),
        ));
    }
    let name = source
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| is_valid_segment(n))
        .ok_or_else(|| StorageError::invalid_path(&source.display().to_string()))?;

    let dest = dir.join(&dest_rel);
    fs::create_dir_all(&dest).at(&dest)?;
    let target = free_name(&dest, name);
    copy_atomic(source, &target)?;

    let file_name = target.file_name().unwrap_or_default();
    Ok(to_slash(&dest_rel.join(file_name)))
}

/// The first of `name`, `stem (2).ext`, `stem (3).ext`… that does not exist in `dir`.
fn free_name(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2u32..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|candidate| !candidate.exists())
        .expect("some numbered name is free")
}

/// Copies through a temporary file, so the target appears only once complete.
fn copy_atomic(source: &Path, target: &Path) -> Result<()> {
    write_atomic_with(target, |out| {
        let mut input = File::open(source).at(source)?;
        io::copy(&mut input, out)?;
        Ok(())
    })
    .map_err(|e: StorageError| e.or_path(target))
}

/// Copies file content only, flushed to disk. Unlike `fs::copy` it does not carry over the
/// read-only attribute, which on Windows would make the copy impossible to replace or delete.
pub(crate) fn copy_file(source: &Path, target: &Path) -> Result<()> {
    let mut input = File::open(source).at(source)?;
    let mut out = File::create(target).at(target)?;
    io::copy(&mut input, &mut out).at(target)?;
    out.sync_all().at(target)
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

    fn project() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        crate::layout::create_project(tmp.path(), &[file("project.json", "{}")]).unwrap();
        tmp
    }

    #[test]
    fn writes_then_deletes() {
        let tmp = project();
        let dir = tmp.path();
        write_project(
            dir,
            &[
                file("data/entities/a.json", "{\"id\":\"a\"}"),
                file("documents/Мир/Глава/Сцена.md", "# Сцена"),
                file("documents/Мир/Обзор.md", "# Обзор"),
            ],
            &[],
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("data/entities/a.json")).unwrap(),
            "{\"id\":\"a\"}"
        );

        write_project(
            dir,
            &[file("data/entities/a.json", "{\"id\":\"a\",\"v\":2}")],
            &[
                "documents/Мир/Глава/Сцена.md".into(),
                "documents/missing.md".into(),
            ],
        )
        .unwrap();
        assert!(dir.join("data/entities/a.json").is_file());
        // The emptied user folder goes, its non-empty parent stays.
        assert!(!dir.join("documents/Мир/Глава").exists());
        assert!(dir.join("documents/Мир/Обзор.md").is_file());

        write_project(dir, &[], &["documents/Мир/Обзор.md".into()]).unwrap();
        assert!(!dir.join("documents/Мир").exists());
        assert!(dir.join("documents").is_dir(), "root folder stays");
    }

    #[test]
    fn keeps_layout_folders_when_emptied() {
        let tmp = project();
        let dir = tmp.path();
        write_project(dir, &[file("data/entities/a.json", "{}")], &[]).unwrap();
        write_project(dir, &[], &["data/entities/a.json".into()]).unwrap();
        assert!(dir.join("data/entities").is_dir());
        write_project(dir, &[file("assets/x.txt", "x")], &[]).unwrap();
        write_project(dir, &[], &["assets/x.txt".into()]).unwrap();
        assert!(dir.join("assets").is_dir());
    }

    #[test]
    fn rejects_the_whole_batch_on_one_bad_path() {
        let tmp = project();
        let dir = tmp.path();
        for (writes, deletes) in [
            (
                vec![file("data/a.json", "{}"), file("backups/x.zip", "")],
                vec![],
            ),
            (
                vec![file("data/a.json", "{}")],
                vec!["../outside".to_owned()],
            ),
            (
                vec![file("data/a.json", "{}")],
                vec!["documents".to_owned()],
            ),
            (vec![file("assets", "x")], vec![]),
        ] {
            let err = write_project(dir, &writes, &deletes).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidPath);
            assert!(!dir.join("data/a.json").exists());
        }
    }

    #[test]
    fn refuses_a_missing_project_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let err =
            write_project(&tmp.path().join("gone"), &[file("data/a.json", "{}")], &[]).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        assert!(!tmp.path().join("gone").exists());
    }

    #[test]
    fn imports_files_with_numbered_names_on_clash() {
        let tmp = project();
        let dir = tmp.path();
        let outside = tempfile::tempdir().unwrap();
        let cover = outside.path().join("cover.png");
        fs::write(&cover, b"png").unwrap();
        let readme = outside.path().join("README");
        fs::write(&readme, b"text").unwrap();

        assert_eq!(
            import_file(dir, &cover, "assets").unwrap(),
            "assets/cover.png"
        );
        assert_eq!(
            import_file(dir, &cover, "assets").unwrap(),
            "assets/cover (2).png"
        );
        assert_eq!(
            import_file(dir, &cover, "assets").unwrap(),
            "assets/cover (3).png"
        );
        assert_eq!(
            import_file(dir, &cover, "assets\\Обложки").unwrap(),
            "assets/Обложки/cover.png"
        );
        assert_eq!(
            import_file(dir, &readme, "assets").unwrap(),
            "assets/README"
        );
        assert_eq!(
            import_file(dir, &readme, "assets").unwrap(),
            "assets/README (2)"
        );
        assert_eq!(fs::read(dir.join("assets/cover (2).png")).unwrap(), b"png");
        // No temporary files left behind.
        let names: Vec<String> = fs::read_dir(dir.join("assets"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().all(|n| !n.contains(".tmp-")), "{names:?}");
    }

    #[test]
    fn import_file_checks_its_arguments() {
        let tmp = project();
        let dir = tmp.path();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("a.png");
        fs::write(&src, b"x").unwrap();
        for dest in ["backups", "../x", "project.json", ""] {
            let err = import_file(dir, &src, dest).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidPath, "{dest}");
        }
        let err = import_file(dir, &outside.path().join("none.png"), "assets").unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }
}
