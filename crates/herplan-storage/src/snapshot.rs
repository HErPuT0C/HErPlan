//! Opening a project: everything the interface needs, read in one call.
//!
//! JSON is returned as text, not parsed: the interface owns the format and decides what a file
//! that does not parse means. Here a file is damaged only if it cannot be turned into text.

use std::fs;
use std::io;
use std::path::Path;
use std::thread;

use crate::atomic::{
    read_file, remove_stale_temp_files, remove_stale_temp_files_recursive, ReadOutcome,
};
use crate::clock::unix_ms;
use crate::error::{AtPath, Result, StorageError};
use crate::layout::require_project;
use crate::model::{AssetInfo, DamageReason, DamagedFile, FileText, ProjectSnapshot};
use crate::paths::{validate_file_path, PROJECT_FILE};
use crate::walk::{walk, Found};

const MAX_READER_THREADS: usize = 8;
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

/// Folders under `.herplan/` left by a restore that did not finish (see `backup.rs`).
const RESTORE_LEFTOVERS: &[&str] = &["restore-", "replaced-"];

/// Reads a whole project: `project.json`, `data/**/*.json`, `documents/**/*.md` as text, and a
/// listing of `assets/`. Cleans up what interrupted writes and restores left behind first.
pub fn read_project(dir: &Path) -> Result<ProjectSnapshot> {
    require_project(dir)?;
    remove_restore_leftovers(dir)?;
    let removed_temp_files = remove_temp_files(dir)?;

    let mut texts = vec![Found {
        rel: PROJECT_FILE.to_owned(),
        abs: dir.join(PROJECT_FILE),
        is_dir: false,
    }];
    texts.extend(list(dir, "data", Some(".json"))?);
    texts.extend(list(dir, "documents", Some(".md"))?);
    texts.sort_by(|a, b| a.rel.cmp(&b.rel));

    let mut snapshot = ProjectSnapshot {
        removed_temp_files,
        ..ProjectSnapshot::default()
    };
    for (found, outcome) in texts.iter().zip(read_parallel(&texts)) {
        let path = found.rel.clone();
        match outcome {
            Text::Ok(text) => snapshot.files.push(FileText { path, text }),
            Text::Damaged(reason, detail) => snapshot.damaged.push(DamagedFile {
                path,
                reason,
                detail,
            }),
            // Deleted between listing and reading, e.g. by a sync client: as if never listed.
            Text::Missing => {}
        }
    }
    snapshot.assets = list_assets(dir)?;
    Ok(snapshot)
}

/// Reads one project file as text; `None` if it does not exist.
pub fn read_project_file(dir: &Path, rel: &str) -> Result<Option<String>> {
    let target = dir.join(validate_file_path(rel)?);
    match fs::read(&target) {
        Ok(bytes) => {
            let text = String::from_utf8(strip_bom(bytes)).map_err(|e| {
                StorageError::io(&io::Error::new(io::ErrorKind::InvalidData, e), &target)
            })?;
            Ok(Some(text))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(StorageError::io(&e, &target)),
    }
}

fn remove_restore_leftovers(dir: &Path) -> Result<()> {
    let cache = dir.join(".herplan");
    if !cache.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&cache).at(&cache)? {
        let entry = entry.at(&cache)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if RESTORE_LEFTOVERS.iter().any(|p| name.starts_with(p)) && entry.path().is_dir() {
            fs::remove_dir_all(entry.path()).at(&entry.path())?;
        }
    }
    Ok(())
}

/// Removes temporary files next to `project.json` and inside `data/`, `documents/`, `.herplan/`.
/// `assets/` is left alone: it holds the user's own files as they are.
fn remove_temp_files(dir: &Path) -> Result<u32> {
    let mut removed = remove_stale_temp_files(dir).at(dir)?;
    for sub in ["data", "documents", ".herplan"] {
        let path = dir.join(sub);
        // A missing folder (or a stray file with that name) has nothing to clean.
        if path.is_dir() {
            removed += remove_stale_temp_files_recursive(&path).at(&path)?;
        }
    }
    Ok(u32::try_from(removed).unwrap_or(u32::MAX))
}

/// Files under a top-level folder, optionally only those with `extension`. A missing folder is
/// empty: a project made by hand may not have all of them.
fn list(dir: &Path, sub: &str, extension: Option<&str>) -> Result<Vec<Found>> {
    let root = dir.join(sub);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    walk(&root, sub, false, &mut found)?;
    if let Some(ext) = extension {
        found.retain(|f| f.rel.to_lowercase().ends_with(ext));
    }
    Ok(found)
}

fn list_assets(dir: &Path) -> Result<Vec<AssetInfo>> {
    // `walk` already skips temporary files.
    let mut assets = list(dir, "assets", None)?
        .into_iter()
        .map(|f| {
            let meta = fs::metadata(&f.abs).at(&f.abs)?;
            Ok(AssetInfo {
                path: f.rel,
                size: meta.len(),
                modified_ms: meta.modified().map(unix_ms).unwrap_or(0),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    assets.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(assets)
}

enum Text {
    Ok(String),
    Damaged(DamageReason, Option<String>),
    Missing,
}

/// Reads files on several threads: opening a large project is dominated by per-file latency,
/// especially on Windows (ADR-004). Results come back in the order of `files`.
fn read_parallel(files: &[Found]) -> Vec<Text> {
    if files.is_empty() {
        return Vec::new();
    }
    let threads = thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(MAX_READER_THREADS);
    let chunk = files.len().div_ceil(threads);
    thread::scope(|scope| {
        let workers: Vec<_> = files
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || part.iter().map(|f| read_text(&f.abs)).collect::<Vec<_>>())
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|w| {
                w.join()
                    .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
            })
            .collect()
    })
}

fn read_text(path: &Path) -> Text {
    match read_file(path) {
        ReadOutcome::Ok(bytes) => {
            let bytes = strip_bom(bytes);
            if bytes.is_empty() {
                return Text::Damaged(DamageReason::Empty, None);
            }
            match String::from_utf8(bytes) {
                Ok(text) => Text::Ok(text),
                Err(e) => Text::Damaged(DamageReason::NotUtf8, Some(e.utf8_error().to_string())),
            }
        }
        ReadOutcome::Empty => Text::Damaged(DamageReason::Empty, None),
        ReadOutcome::Missing => Text::Missing,
        ReadOutcome::Failed(message) => Text::Damaged(DamageReason::Unreadable, Some(message)),
    }
}

/// Editors on Windows sometimes add a byte order mark; it is not part of the text.
fn strip_bom(mut bytes: Vec<u8>) -> Vec<u8> {
    if bytes.starts_with(UTF8_BOM) {
        bytes.drain(..UTF8_BOM.len());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::model::FileText;

    fn project() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        crate::layout::create_project(
            tmp.path(),
            &[FileText {
                path: "project.json".into(),
                text: "{\"name\":\"p\"}".into(),
            }],
        )
        .unwrap();
        tmp
    }

    fn put(dir: &Path, rel: &str, bytes: &[u8]) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn reads_texts_and_classifies_damage() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "data/types.json", b"{}");
        put(dir, "data/entities/b.json", b"\xEF\xBB\xBF{\"id\":\"b\"}");
        put(dir, "data/entities/a.json", b"{ not json");
        put(dir, "data/entities/empty.json", b"");
        put(dir, "data/entities/bom-only.json", b"\xEF\xBB\xBF");
        put(dir, "data/entities/latin1.json", b"{\"name\":\"\xE9\"}");
        put(dir, "data/notes.txt", b"ignored");
        put(dir, "documents/Мир/Диздок.md", "# Диздок".as_bytes());
        put(dir, "documents/image.png", b"ignored");
        put(dir, "assets/cover.png", b"12345");
        put(dir, "assets/sub/b.bin", b"1");
        put(dir, "backups/auto/x.json", b"ignored");

        let snap = read_project(dir).unwrap();
        let files: Vec<(&str, &str)> = snap
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.text.as_str()))
            .collect();
        assert_eq!(
            files,
            vec![
                ("data/entities/a.json", "{ not json"),
                ("data/entities/b.json", "{\"id\":\"b\"}"),
                ("data/types.json", "{}"),
                ("documents/Мир/Диздок.md", "# Диздок"),
                ("project.json", "{\"name\":\"p\"}"),
            ]
        );
        let damaged: Vec<(&str, DamageReason)> = snap
            .damaged
            .iter()
            .map(|d| (d.path.as_str(), d.reason))
            .collect();
        assert_eq!(
            damaged,
            vec![
                ("data/entities/bom-only.json", DamageReason::Empty),
                ("data/entities/empty.json", DamageReason::Empty),
                ("data/entities/latin1.json", DamageReason::NotUtf8),
            ]
        );
        assert!(snap.damaged[2].detail.is_some());
        let assets: Vec<(&str, u64)> = snap
            .assets
            .iter()
            .map(|a| (a.path.as_str(), a.size))
            .collect();
        assert_eq!(
            assets,
            vec![("assets/cover.png", 5), ("assets/sub/b.bin", 1)]
        );
        assert!(snap.assets[0].modified_ms > 0);
        assert_eq!(snap.removed_temp_files, 0);
    }

    #[test]
    fn removes_stale_temp_files_and_restore_leftovers() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, ".project.json.tmp-1", b"x");
        put(dir, "data/entities/.a.json.tmp-2", b"x");
        put(dir, "documents/Мир/.Диздок.md.tmp-3", b"x");
        put(dir, ".herplan/.workspace.json.tmp-4", b"x");
        put(dir, "assets/.cover.png.tmp-5", b"x");
        put(
            dir,
            ".herplan/restore-2026-10-18T09-40-00Z/project.json",
            b"{}",
        );
        put(
            dir,
            ".herplan/replaced-2026-10-18T09-40-00Z/data/a.json",
            b"{}",
        );
        put(dir, ".herplan/workspace.json", b"{}");

        let snap = read_project(dir).unwrap();
        assert_eq!(snap.removed_temp_files, 4);
        assert!(!dir.join("data/entities/.a.json.tmp-2").exists());
        assert!(!dir.join(".herplan/restore-2026-10-18T09-40-00Z").exists());
        assert!(!dir.join(".herplan/replaced-2026-10-18T09-40-00Z").exists());
        assert!(dir.join(".herplan/workspace.json").exists());
        // Temp files in assets are not touched, but not listed either.
        assert!(dir.join("assets/.cover.png.tmp-5").exists());
        assert!(snap.assets.is_empty());
    }

    #[test]
    fn reads_many_files_in_order() {
        let tmp = project();
        let dir = tmp.path();
        for i in 0..300 {
            put(
                dir,
                &format!("data/entities/{i:04}.json"),
                format!("{{\"n\":{i}}}").as_bytes(),
            );
        }
        let snap = read_project(dir).unwrap();
        assert_eq!(snap.files.len(), 301);
        assert_eq!(snap.files[0].path, "data/entities/0000.json");
        assert_eq!(snap.files[299].text, "{\"n\":299}");
        assert_eq!(snap.files[300].path, "project.json");
    }

    #[test]
    fn tolerates_missing_layout_folders() {
        let tmp = tempfile::tempdir().unwrap();
        put(tmp.path(), "project.json", b"{}");
        // A stray file where a folder is expected is not an error either.
        put(tmp.path(), ".herplan", b"x");
        let snap = read_project(tmp.path()).unwrap();
        assert_eq!(snap.files.len(), 1);
        assert!(snap.assets.is_empty());
    }

    #[test]
    fn reports_missing_folders_and_non_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let err = read_project(&tmp.path().join("gone")).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        let err = read_project(tmp.path()).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotAProject);
    }

    #[test]
    fn reads_single_files() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, ".herplan/workspace.json", b"\xEF\xBB\xBF{\"tabs\":[]}");
        assert_eq!(
            read_project_file(dir, ".herplan/workspace.json").unwrap(),
            Some("{\"tabs\":[]}".to_owned())
        );
        assert_eq!(read_project_file(dir, "data/none.json").unwrap(), None);
        for bad in ["../secret", "data", "backups/auto/x.zip"] {
            let err = read_project_file(dir, bad).unwrap_err();
            assert_eq!(err.code, ErrorCode::InvalidPath, "{bad}");
        }
    }
}
