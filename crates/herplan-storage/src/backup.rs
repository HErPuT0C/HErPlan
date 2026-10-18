//! Backups (docs/format/project-v1.md, "Резервные копии"): zips of the project in
//! `backups/auto/` and `backups/manual/`, named by UTC time, e.g. `2026-10-18T09-40-00Z.zip`.
//! A manual version has a sidecar `<name>.json` with its label. Automatic copies are pruned by
//! the project's `keep` setting; manual versions are kept forever.

use std::cmp::Reverse;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::archive::{write_project_zip, Archive};
use crate::atomic::{rename_with_retry, write_atomic};
use crate::clock::Utc;
use crate::error::{AtPath, Result, StorageError};
use crate::layout::{ensure_layout, require_project};
use crate::model::{BackupInfo, BackupKind};
use crate::paths::PROJECT_FILE;

const BACKUPS_DIR: &str = "backups";

/// What a restore replaces. Everything else in the folder (the user's own files, `.git`) stays.
const MANAGED_ROOTS: &[&str] = &[PROJECT_FILE, "data", "documents", "assets"];

/// Contents of `backups/manual/<name>.json`, in the documented key order.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sidecar {
    label: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
}

/// Zips the project into `backups/<kind>/`. The label is kept for manual versions only.
pub fn create_backup(dir: &Path, kind: BackupKind, label: Option<&str>) -> Result<BackupInfo> {
    require_project(dir)?;
    let folder = backup_dir(dir, kind);
    fs::create_dir_all(&folder).at(&folder)?;
    let now = Utc::now();
    let name = free_name(&folder, &now.file_stamp());
    let zip_path = folder.join(format!("{name}.zip"));
    write_project_zip(dir, &zip_path)?;

    let label = match kind {
        BackupKind::Auto => None,
        BackupKind::Manual => label.map(str::to_owned),
    };
    if kind == BackupKind::Manual {
        let sidecar = Sidecar {
            label: label.clone(),
            created_at: Some(now.iso()),
        };
        let mut text = serde_json::to_string_pretty(&sidecar).expect("sidecar serializes");
        text.push('\n');
        let path = folder.join(format!("{name}.json"));
        write_atomic(&path, text.as_bytes()).at(&path)?;
    }
    let size = fs::metadata(&zip_path).at(&zip_path)?.len();
    Ok(BackupInfo {
        kind,
        name,
        created_at: now.iso(),
        size,
        label,
    })
}

/// All backups of both kinds, newest first. Files that are not backups are ignored.
pub fn list_backups(dir: &Path) -> Result<Vec<BackupInfo>> {
    let mut all = list_kind(dir, BackupKind::Auto)?;
    all.extend(list_kind(dir, BackupKind::Manual)?);
    all.sort_by_key(|l| Reverse(l.order));
    Ok(all.into_iter().map(|l| l.info).collect())
}

/// Deletes the oldest automatic copies beyond `keep`; `None` keeps all. Manual versions are never
/// touched. Returns how many copies were deleted.
pub fn prune_backups(dir: &Path, keep: Option<u32>) -> Result<u32> {
    let Some(keep) = keep else {
        return Ok(0);
    };
    let mut autos = list_kind(dir, BackupKind::Auto)?;
    autos.sort_by_key(|l| Reverse(l.order));
    let mut deleted = 0;
    for old in autos.iter().skip(keep as usize) {
        let path = backup_dir(dir, BackupKind::Auto).join(format!("{}.zip", old.info.name));
        match fs::remove_file(&path) {
            Ok(()) => deleted += 1,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(StorageError::io(&e, &path)),
        }
    }
    Ok(deleted)
}

/// Replaces the project content with a backup. A manual safety copy labelled `safety_label` is
/// made first, so a restore can itself be undone; its info is returned.
///
/// The backup is unpacked into `.herplan/restore-<time>/`, then each managed root is swapped:
/// the current one moves to `.herplan/replaced-<time>/`, the restored one moves in. Renames
/// within one folder are fast and do not copy data. If a swap fails, the moves done so far are
/// reversed; folders left by a crash are removed the next time the project is opened.
pub fn restore_backup(
    dir: &Path,
    kind: BackupKind,
    name: &str,
    safety_label: &str,
) -> Result<BackupInfo> {
    require_project(dir)?;
    if parse_name(name).is_none() {
        return Err(StorageError::invalid_path(name));
    }
    let zip_path = backup_dir(dir, kind).join(format!("{name}.zip"));
    let mut archive = Archive::open(&zip_path)?;
    if archive.project_depth() != Some(0) {
        return Err(StorageError::bad_archive(
            "the backup has no project.json",
            &zip_path,
        ));
    }

    let safety = create_backup(dir, BackupKind::Manual, Some(safety_label))?;

    let cache = dir.join(".herplan");
    fs::create_dir_all(&cache).at(&cache)?;
    let (restored, replaced) = work_dirs(&cache);
    fs::create_dir(&restored).at(&restored)?;
    let result = fs::create_dir(&replaced)
        .at(&replaced)
        .and_then(|()| archive.extract(0, &restored))
        .and_then(|()| swap_roots(dir, &restored, &replaced));
    // Best effort: whatever stays behind is removed when the project is opened next. After a
    // failed swap `replaced` may still hold current content that could not be moved back, so it
    // is only removed when empty (the safety copy has everything in any case).
    let _ = fs::remove_dir_all(&restored);
    if result.is_ok() {
        let _ = fs::remove_dir_all(&replaced);
    } else {
        let _ = fs::remove_dir(&replaced);
    }
    result?;
    ensure_layout(dir)?;
    Ok(safety)
}

fn backup_dir(dir: &Path, kind: BackupKind) -> PathBuf {
    dir.join(BACKUPS_DIR).join(kind.dir_name())
}

/// `stamp`, or `stamp-2`, `stamp-3`… if a backup with that name already exists.
fn free_name(folder: &Path, stamp: &str) -> String {
    let taken = |name: &str| {
        folder.join(format!("{name}.zip")).exists() || folder.join(format!("{name}.json")).exists()
    };
    if !taken(stamp) {
        return stamp.to_owned();
    }
    (2u32..)
        .map(|n| format!("{stamp}-{n}"))
        .find(|name| !taken(name))
        .expect("some numbered name is free")
}

/// Splits a backup name into its time and sequence number (1 without a suffix).
fn parse_name(name: &str) -> Option<(Utc, u32)> {
    let stamp = name.get(..20)?;
    let utc = Utc::parse_file_stamp(stamp)?;
    let seq = match &name[20..] {
        "" => 1,
        suffix => {
            let digits = suffix.strip_prefix('-')?;
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            digits.parse().ok().filter(|n| *n >= 2)?
        }
    };
    Some((utc, seq))
}

struct Listed {
    info: BackupInfo,
    order: (Utc, u32, BackupKind),
}

fn list_kind(dir: &Path, kind: BackupKind) -> Result<Vec<Listed>> {
    let folder = backup_dir(dir, kind);
    let entries = match fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(StorageError::io(&e, &folder)),
    };
    let mut listed = Vec::new();
    for entry in entries {
        let entry = entry.at(&folder)?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let Some(name) = file_name.strip_suffix(".zip") else {
            continue;
        };
        let Some((utc, seq)) = parse_name(name) else {
            continue;
        };
        let meta = entry.metadata().at(&entry.path())?;
        if !meta.is_file() {
            continue;
        }
        let label = match kind {
            BackupKind::Auto => None,
            BackupKind::Manual => read_label(&folder.join(format!("{name}.json"))),
        };
        listed.push(Listed {
            info: BackupInfo {
                kind,
                name: name.to_owned(),
                created_at: utc.iso(),
                size: meta.len(),
                label,
            },
            order: (utc, seq, kind),
        });
    }
    Ok(listed)
}

/// The label of a manual version; a missing or unreadable sidecar just means no label.
fn read_label(sidecar: &Path) -> Option<String> {
    let text = fs::read_to_string(sidecar).ok()?;
    serde_json::from_str::<Sidecar>(text.trim_start_matches('\u{feff}'))
        .ok()?
        .label
}

/// Fresh `.herplan/restore-<time>` and `.herplan/replaced-<time>` paths.
fn work_dirs(cache: &Path) -> (PathBuf, PathBuf) {
    let stamp = Utc::now().file_stamp();
    (1u32..)
        .map(|n| match n {
            1 => stamp.clone(),
            n => format!("{stamp}-{n}"),
        })
        .map(|s| {
            (
                cache.join(format!("restore-{s}")),
                cache.join(format!("replaced-{s}")),
            )
        })
        .find(|(a, b)| !a.exists() && !b.exists())
        .expect("some numbered name is free")
}

fn swap_roots(dir: &Path, restored: &Path, replaced: &Path) -> Result<()> {
    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut step = |from: PathBuf, to: PathBuf| -> Result<()> {
        if fs::symlink_metadata(&from).is_ok() {
            rename_with_retry(&from, &to).at(&to)?;
            moves.push((from, to));
        }
        Ok(())
    };
    let result = MANAGED_ROOTS.iter().try_for_each(|root| {
        step(dir.join(root), replaced.join(root))?;
        step(restored.join(root), dir.join(root))
    });
    if result.is_err() {
        for (from, to) in moves.iter().rev() {
            let _ = fs::rename(to, from);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::model::FileText;
    use crate::write::write_project;

    fn file(path: &str, text: &str) -> FileText {
        FileText {
            path: path.into(),
            text: text.into(),
        }
    }

    fn project() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        crate::layout::create_project(
            tmp.path(),
            &[
                file("project.json", "{\"v\":1}"),
                file("data/entities/a.json", "{\"id\":\"a\"}"),
                file("documents/Диздок.md", "# v1"),
            ],
        )
        .unwrap();
        tmp
    }

    fn fake_backup(dir: &Path, kind: BackupKind, name: &str) {
        let folder = backup_dir(dir, kind);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(format!("{name}.zip")), b"zip").unwrap();
    }

    fn stamp(i: u32) -> String {
        format!(
            "2026-10-{:02}T{:02}-{:02}-00Z",
            1 + i / 600,
            i / 60 % 10,
            i % 60
        )
    }

    #[test]
    fn creates_and_lists_backups() {
        let tmp = project();
        let dir = tmp.path();
        let auto = create_backup(dir, BackupKind::Auto, Some("ignored")).unwrap();
        assert_eq!(auto.label, None);
        assert!(auto.size > 0);
        assert!(parse_name(&auto.name).is_some());
        assert_eq!(auto.created_at.len(), 20);
        assert!(backup_dir(dir, BackupKind::Auto)
            .join(format!("{}.zip", auto.name))
            .is_file());

        let manual = create_backup(dir, BackupKind::Manual, Some("Перед главой 3")).unwrap();
        assert_eq!(manual.label.as_deref(), Some("Перед главой 3"));
        let sidecar = fs::read_to_string(
            backup_dir(dir, BackupKind::Manual).join(format!("{}.json", manual.name)),
        )
        .unwrap();
        assert_eq!(
            sidecar,
            format!(
                "{{\n  \"label\": \"Перед главой 3\",\n  \"createdAt\": \"{}\"\n}}\n",
                manual.created_at
            )
        );

        // The backup holds the project but not backups/ or .herplan/.
        let zip_path = backup_dir(dir, BackupKind::Manual).join(format!("{}.zip", manual.name));
        let archive = zip::ZipArchive::new(fs::File::open(zip_path).unwrap()).unwrap();
        let names: Vec<String> = archive
            .file_names()
            .map(|n| n.unwrap().into_owned())
            .collect();
        assert!(names.contains(&"project.json".to_owned()));
        assert!(names
            .iter()
            .all(|n| !n.starts_with("backups") && !n.starts_with(".herplan")));

        let listed = list_backups(dir).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.contains(&auto));
        assert!(listed.contains(&manual));
    }

    #[test]
    fn numbers_backups_made_in_the_same_second() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path();
        assert_eq!(
            free_name(folder, "2026-10-18T09-40-00Z"),
            "2026-10-18T09-40-00Z"
        );
        fs::write(folder.join("2026-10-18T09-40-00Z.zip"), b"").unwrap();
        assert_eq!(
            free_name(folder, "2026-10-18T09-40-00Z"),
            "2026-10-18T09-40-00Z-2"
        );
        fs::write(folder.join("2026-10-18T09-40-00Z-2.json"), b"").unwrap();
        assert_eq!(
            free_name(folder, "2026-10-18T09-40-00Z"),
            "2026-10-18T09-40-00Z-3"
        );
    }

    #[test]
    fn lists_newest_first_and_ignores_other_files() {
        let tmp = project();
        let dir = tmp.path();
        fake_backup(dir, BackupKind::Auto, "2026-10-18T09-40-00Z");
        fake_backup(dir, BackupKind::Auto, "2026-10-18T09-40-00Z-2");
        fake_backup(dir, BackupKind::Auto, "2026-10-18T09-50-00Z");
        fake_backup(dir, BackupKind::Manual, "2026-10-18T09-45-00Z");
        fake_backup(dir, BackupKind::Manual, "2026-10-18T09-46-00Z");
        let manual = backup_dir(dir, BackupKind::Manual);
        fs::write(
            manual.join("2026-10-18T09-45-00Z.json"),
            "{\"label\":\"v1\",\"createdAt\":\"2026-10-18T09:45:00Z\"}",
        )
        .unwrap();
        fs::write(manual.join("2026-10-18T09-46-00Z.json"), "not json").unwrap();
        fs::write(manual.join("readme.txt"), "x").unwrap();
        fs::write(manual.join("2026.zip"), "x").unwrap();
        fs::write(manual.join(".2026-10-18T09-47-00Z.zip.tmp-1"), "x").unwrap();

        let listed: Vec<(BackupKind, String, Option<String>)> = list_backups(dir)
            .unwrap()
            .into_iter()
            .map(|b| (b.kind, b.name, b.label))
            .collect();
        assert_eq!(
            listed,
            vec![
                (BackupKind::Auto, "2026-10-18T09-50-00Z".into(), None),
                (BackupKind::Manual, "2026-10-18T09-46-00Z".into(), None),
                (
                    BackupKind::Manual,
                    "2026-10-18T09-45-00Z".into(),
                    Some("v1".into())
                ),
                (BackupKind::Auto, "2026-10-18T09-40-00Z-2".into(), None),
                (BackupKind::Auto, "2026-10-18T09-40-00Z".into(), None),
            ]
        );
        let first = &list_backups(dir).unwrap()[0];
        assert_eq!(first.created_at, "2026-10-18T09:50:00Z");
        assert_eq!(first.size, 3);
    }

    #[test]
    fn prunes_oldest_automatic_copies_only() {
        let tmp = project();
        let dir = tmp.path();
        for i in 0..55 {
            fake_backup(dir, BackupKind::Auto, &stamp(i));
        }
        for i in 0..3 {
            fake_backup(dir, BackupKind::Manual, &stamp(i));
        }
        assert_eq!(prune_backups(dir, None).unwrap(), 0);
        assert_eq!(list_backups(dir).unwrap().len(), 58);

        assert_eq!(prune_backups(dir, Some(50)).unwrap(), 5);
        let left = list_backups(dir).unwrap();
        let autos: Vec<&str> = left
            .iter()
            .filter(|b| b.kind == BackupKind::Auto)
            .map(|b| b.name.as_str())
            .collect();
        assert_eq!(autos.len(), 50);
        // The five oldest are gone.
        for i in 0..5 {
            assert!(!autos.contains(&stamp(i).as_str()));
        }
        assert!(autos.contains(&stamp(5).as_str()));
        assert_eq!(
            left.iter().filter(|b| b.kind == BackupKind::Manual).count(),
            3
        );

        assert_eq!(prune_backups(dir, Some(50)).unwrap(), 0);
        assert_eq!(prune_backups(dir, Some(0)).unwrap(), 50);
        assert_eq!(list_backups(dir).unwrap().len(), 3);
    }

    #[test]
    fn restores_a_backup_and_keeps_a_safety_copy() {
        let tmp = project();
        let dir = tmp.path();
        fs::write(dir.join("assets/cover.png"), b"old").unwrap();
        let backup = create_backup(dir, BackupKind::Auto, None).unwrap();

        write_project(
            dir,
            &[
                file("project.json", "{\"v\":2}"),
                file("data/entities/b.json", "{\"id\":\"b\"}"),
            ],
            &["documents/Диздок.md".into()],
        )
        .unwrap();
        fs::remove_file(dir.join("assets/cover.png")).unwrap();
        fs::write(dir.join("notes.txt"), b"user file at the root").unwrap();

        let safety =
            restore_backup(dir, BackupKind::Auto, &backup.name, "Перед восстановлением").unwrap();
        assert_eq!(safety.kind, BackupKind::Manual);
        assert_eq!(safety.label.as_deref(), Some("Перед восстановлением"));

        assert_eq!(
            fs::read_to_string(dir.join("project.json")).unwrap(),
            "{\"v\":1}"
        );
        assert!(dir.join("data/entities/a.json").is_file());
        assert!(!dir.join("data/entities/b.json").exists());
        assert_eq!(
            fs::read_to_string(dir.join("documents/Диздок.md")).unwrap(),
            "# v1"
        );
        assert_eq!(fs::read(dir.join("assets/cover.png")).unwrap(), b"old");
        assert!(
            dir.join("notes.txt").is_file(),
            "files outside managed roots stay"
        );
        for sub in crate::layout::LAYOUT_DIRS {
            assert!(dir.join(sub).is_dir(), "{sub}");
        }
        let leftovers: Vec<_> = fs::read_dir(dir.join(".herplan")).unwrap().collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");

        // The safety copy holds the state before the restore and can be restored in turn.
        restore_backup(dir, BackupKind::Manual, &safety.name, "again").unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("project.json")).unwrap(),
            "{\"v\":2}"
        );
        assert!(dir.join("data/entities/b.json").is_file());
        assert!(!dir.join("documents/Диздок.md").exists());
        assert!(!dir.join("assets/cover.png").exists());
    }

    #[test]
    fn restore_rejects_bad_backups_without_touching_the_project() {
        let tmp = project();
        let dir = tmp.path();
        let auto = backup_dir(dir, BackupKind::Auto);
        fs::write(auto.join("2026-10-18T09-40-00Z.zip"), b"not a zip").unwrap();
        let err = restore_backup(dir, BackupKind::Auto, "2026-10-18T09-40-00Z", "s").unwrap_err();
        assert_eq!(err.code, ErrorCode::BadArchive);

        let mut zip =
            zip::ZipWriter::new(fs::File::create(auto.join("2026-10-18T09-41-00Z.zip")).unwrap());
        zip.start_file("data/a.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
        let err = restore_backup(dir, BackupKind::Auto, "2026-10-18T09-41-00Z", "s").unwrap_err();
        assert_eq!(err.code, ErrorCode::BadArchive);

        let err = restore_backup(dir, BackupKind::Auto, "../../evil", "s").unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidPath);
        let err = restore_backup(dir, BackupKind::Auto, "2026-10-18T10-00-00Z", "s").unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);

        // No safety copies were made and the project is intact.
        assert!(list_backups(dir)
            .unwrap()
            .iter()
            .all(|b| b.kind == BackupKind::Auto));
        assert_eq!(
            fs::read_to_string(dir.join("project.json")).unwrap(),
            "{\"v\":1}"
        );
    }

    #[test]
    fn failed_swap_moves_everything_back() {
        let tmp = project();
        let dir = tmp.path();
        let restored = dir.join(".herplan/restore-x");
        let replaced = dir.join(".herplan/replaced-x");
        fs::create_dir_all(restored.join("data")).unwrap();
        fs::write(restored.join("project.json"), "{\"v\":0}").unwrap();
        // An occupied destination makes the move of data/ fail after project.json was swapped.
        fs::create_dir_all(replaced.join("data/occupied")).unwrap();

        assert!(swap_roots(dir, &restored, &replaced).is_err());
        assert_eq!(
            fs::read_to_string(dir.join("project.json")).unwrap(),
            "{\"v\":1}"
        );
        assert!(dir.join("data/entities/a.json").is_file());
        assert_eq!(
            fs::read_to_string(restored.join("project.json")).unwrap(),
            "{\"v\":0}"
        );
        assert!(!replaced.join("project.json").exists());
    }

    #[test]
    fn parses_backup_names() {
        assert_eq!(parse_name("2026-10-18T09-40-00Z").unwrap().1, 1);
        assert_eq!(parse_name("2026-10-18T09-40-00Z-12").unwrap().1, 12);
        for bad in [
            "",
            "2026-10-18T09-40-00Z-",
            "2026-10-18T09-40-00Z-1",
            "2026-10-18T09-40-00Z-x",
            "2026-10-18T09-40-00Z.zip",
            "../2026-10-18T09-40-00Z",
        ] {
            assert!(parse_name(bad).is_none(), "{bad}");
        }
    }
}
