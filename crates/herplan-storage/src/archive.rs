//! Zip archives of a project (export, import, backups) and importing a project folder.
//!
//! An archive holds the whole project except `backups/`, `.herplan/` and temporary files, with
//! entries sorted by path and forward slashes, so the same project gives the same entry list on
//! every machine. Archives from elsewhere are untrusted: every entry name is checked like an
//! interface path before anything is extracted.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use zip::result::ZipError;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter, ZIP64_BYTES_THR};

use crate::atomic::{is_temp_name, rename_with_retry, temp_path, write_atomic_with};
use crate::clock::Utc;
use crate::error::{code_for, AtPath, ErrorCode, Result, StorageError};
use crate::layout::{check_new_project_dir, ensure_layout, require_project};
use crate::paths::{segments, PROJECT_FILE};
use crate::walk::{project_content, Found};
use crate::write::copy_file;

/// Top-level folders never taken from an archive or a copied folder.
const EXCLUDED_ROOTS: &[&str] = &["backups", ".herplan"];

/// Metadata folder that macOS adds next to the real content of zips it creates.
const MACOS_METADATA: &str = "__MACOSX";

/// Exports the project as a zip at `target` (written atomically).
pub fn export_zip(dir: &Path, target: &Path) -> Result<()> {
    require_project(dir)?;
    write_project_zip(dir, target)
}

/// Unpacks a project archive into `target_dir`, which must be missing or empty.
/// `project.json` may be at the archive root or inside a single top-level folder.
pub fn import_zip(source: &Path, target_dir: &Path) -> Result<()> {
    check_new_project_dir(target_dir)?;
    let mut archive = Archive::open(source)?;
    let depth = archive
        .project_depth()
        .ok_or_else(|| StorageError::not_a_project(source))?;
    install_new_project(target_dir, |tmp| archive.extract(depth, tmp))
}

/// Copies a project folder into `target_dir`, which must be missing or empty.
pub fn import_folder(source: &Path, target_dir: &Path) -> Result<()> {
    require_project(source)?;
    check_new_project_dir(target_dir)?;
    // Listed before the copy starts, so a target inside the source is not copied into itself.
    let content = project_content(source)?;
    install_new_project(target_dir, |tmp| copy_content(&content, tmp))
}

/// Writes the project content into a zip at `target`, atomically.
pub(crate) fn write_project_zip(dir: &Path, target: &Path) -> Result<()> {
    let content = project_content(dir)?;
    write_atomic_with(target, |file| {
        let mut zip = ZipWriter::new(BufWriter::new(file));
        for item in &content {
            add_entry(&mut zip, item)?;
        }
        let mut out = zip.finish().map_err(zip_error)?;
        out.flush()?;
        Ok(())
    })
    .map_err(|e: StorageError| e.or_path(target))
}

fn add_entry<W: Write + io::Seek>(zip: &mut ZipWriter<W>, item: &Found) -> Result<()> {
    let meta = fs::metadata(&item.abs).at(&item.abs)?;
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(zip_time(meta.modified().ok()))
        .large_file(meta.len() >= ZIP64_BYTES_THR);
    if item.is_dir {
        return zip
            .add_directory(format!("{}/", item.rel), options)
            .map_err(zip_error);
    }
    zip.start_file(item.rel.as_str(), options)
        .map_err(zip_error)?;
    let mut source = File::open(&item.abs).at(&item.abs)?;
    io::copy(&mut source, zip)?;
    Ok(())
}

/// Zip stores local calendar time without a zone; UTC keeps archives the same on every machine.
fn zip_time(modified: Option<SystemTime>) -> DateTime {
    modified
        .map(Utc::from_system)
        .and_then(|t| {
            DateTime::from_date_and_time(
                u16::try_from(t.year).ok()?,
                t.month as u8,
                t.day as u8,
                t.hour as u8,
                t.minute as u8,
                t.second as u8,
            )
            .ok()
        })
        .unwrap_or_default()
}

/// Write-side zip errors are I/O in practice (disk full); keep their code.
fn zip_error(err: ZipError) -> StorageError {
    match err {
        ZipError::Io(e) => e.into(),
        other => StorageError::new(ErrorCode::Io, other.to_string(), None),
    }
}

/// One archive entry that passed the name checks.
struct Entry {
    index: usize,
    segments: Vec<String>,
    is_dir: bool,
}

/// An opened archive whose entry names are all safe relative paths.
pub(crate) struct Archive {
    zip: ZipArchive<BufReader<File>>,
    entries: Vec<Entry>,
    source: PathBuf,
}

impl Archive {
    pub fn open(source: &Path) -> Result<Self> {
        let file = File::open(source).at(source)?;
        let zip = ZipArchive::new(BufReader::new(file)).map_err(|e| read_error(e, source))?;
        let mut entries = Vec::with_capacity(zip.len());
        for index in 0..zip.len() {
            let entry = zip
                .by_index_data(index)
                .map_err(|e| read_error(e, source))?;
            let name = entry.name().map_err(|e| read_error(e, source))?;
            if entry.is_symlink() {
                // A link could point outside the project; HErPlan never writes them.
                continue;
            }
            let trimmed = name.trim_end_matches(['/', '\\']);
            if trimmed == MACOS_METADATA || trimmed.starts_with("__MACOSX/") {
                continue;
            }
            let parts = segments(trimmed).ok_or_else(|| {
                StorageError::bad_archive(format!("unsafe entry name: {name:?}"), source)
            })?;
            entries.push(Entry {
                index,
                segments: parts.into_iter().map(str::to_owned).collect(),
                // Some Windows tools end folder names with a backslash.
                is_dir: entry.is_dir() || name.ends_with('\\'),
            });
        }
        Ok(Self {
            zip,
            entries,
            source: source.to_path_buf(),
        })
    }

    /// How many leading folders to strip to reach `project.json`: 0 when it is at the root, 1 when
    /// everything sits in one top-level folder that holds it. `None` if there is no project.
    pub fn project_depth(&self) -> Option<usize> {
        let is_project_file = |e: &Entry, depth: usize| {
            !e.is_dir && e.segments.len() == depth + 1 && e.segments[depth] == PROJECT_FILE
        };
        if self.entries.iter().any(|e| is_project_file(e, 0)) {
            return Some(0);
        }
        let top = &self.entries.first()?.segments[0];
        let single_top = self.entries.iter().all(|e| &e.segments[0] == top);
        (single_top && self.entries.iter().any(|e| is_project_file(e, 1))).then_some(1)
    }

    /// Extracts everything below `depth` leading folders into `into`, skipping `backups/`,
    /// `.herplan/` and temporary files.
    pub fn extract(&mut self, depth: usize, into: &Path) -> Result<()> {
        for entry in &self.entries {
            let Some(parts) = entry.segments.get(depth..).filter(|p| !p.is_empty()) else {
                continue;
            };
            let excluded = EXCLUDED_ROOTS.contains(&parts[0].as_str())
                || (!entry.is_dir && parts.last().is_some_and(|n| is_temp_name(n)));
            if excluded {
                continue;
            }
            let out: PathBuf = into.join(parts.iter().collect::<PathBuf>());
            if entry.is_dir {
                fs::create_dir_all(&out).at(&out)?;
                continue;
            }
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).at(parent)?;
            }
            let mut reader = self
                .zip
                .by_index(entry.index)
                .map_err(|e| read_error(e, &self.source))?;
            let mut file = File::create(&out).at(&out)?;
            if let Err(e) = io::copy(&mut reader, &mut file) {
                return Err(copy_error(&e, &self.source, &out));
            }
            file.sync_all().at(&out)?;
        }
        Ok(())
    }
}

/// Read-side zip errors mean a broken or unsupported archive, unless the disk itself failed.
fn read_error(err: ZipError, source: &Path) -> StorageError {
    match err {
        ZipError::Io(e)
            if !matches!(
                e.kind(),
                io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof
            ) =>
        {
            StorageError::io(&e, source)
        }
        other => StorageError::bad_archive(other.to_string(), source),
    }
}

/// While unpacking, corrupt data is the archive's fault; anything else is the target disk's.
fn copy_error(err: &io::Error, source: &Path, out: &Path) -> StorageError {
    let corrupt = matches!(
        err.kind(),
        io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof
    ) && code_for(err) == ErrorCode::Io;
    if corrupt {
        StorageError::bad_archive(err.to_string(), source)
    } else {
        StorageError::io(err, out)
    }
}

fn copy_content(content: &[Found], into: &Path) -> Result<()> {
    for item in content {
        let out = into.join(item.rel.split('/').collect::<PathBuf>());
        if item.is_dir {
            fs::create_dir_all(&out).at(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).at(parent)?;
        }
        copy_file(&item.abs, &out)?;
    }
    Ok(())
}

/// Builds a project in a temporary sibling folder and renames it into place, so a failed import
/// never leaves a half-filled target behind.
fn install_new_project(target: &Path, fill: impl FnOnce(&Path) -> Result<()>) -> Result<()> {
    let tmp = temp_path(target);
    if let Some(parent) = tmp.parent() {
        fs::create_dir_all(parent).at(parent)?;
    }
    if tmp.exists() {
        fs::remove_dir_all(&tmp).at(&tmp)?;
    }
    fs::create_dir(&tmp).at(&tmp)?;
    // The target is checked to be missing or empty; an empty one is removed just before the
    // rename, since Windows cannot rename a folder over an existing one.
    let had_target = target.is_dir();
    let result = fill(&tmp)
        .and_then(|()| ensure_layout(&tmp))
        .and_then(|()| {
            if had_target {
                fs::remove_dir(target).at(target)?;
            }
            rename_with_retry(&tmp, target).at(target)
        });
    if result.is_err() {
        let _ = fs::remove_dir_all(&tmp);
        if had_target {
            let _ = fs::create_dir(target);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::FileText;
    use std::collections::BTreeMap;

    fn project() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let file = |path: &str, text: &str| FileText {
            path: path.into(),
            text: text.into(),
        };
        crate::layout::create_project(
            tmp.path(),
            &[
                file("project.json", "{\"name\":\"Мельница\"}\n"),
                file("data/types.json", "{\"types\":[]}\n"),
                file("data/entities/a.json", "{\"id\":\"a\"}\n"),
                file("documents/Мир/Диздок.md", "# Диздок\n"),
                file(".herplan/workspace.json", "{}"),
            ],
        )
        .unwrap();
        let dir = tmp.path();
        fs::write(dir.join("assets/cover.png"), [0u8, 1, 2, 255]).unwrap();
        fs::create_dir_all(dir.join("documents/Пусто")).unwrap();
        fs::write(dir.join("backups/auto/old.zip"), b"x").unwrap();
        fs::write(dir.join("data/.types.json.tmp-1"), b"partial").unwrap();
        tmp
    }

    /// Every file of a project except backups/ and .herplan/, by relative path.
    fn files_of(dir: &Path) -> BTreeMap<String, Vec<u8>> {
        project_content(dir)
            .unwrap()
            .into_iter()
            .filter(|f| !f.is_dir)
            .map(|f| (f.rel, fs::read(&f.abs).unwrap()))
            .collect()
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        for (name, data) in entries {
            if name.ends_with('/') {
                zip.add_directory(*name, SimpleFileOptions::default())
                    .unwrap();
            } else {
                zip.start_file(*name, SimpleFileOptions::default()).unwrap();
                zip.write_all(data).unwrap();
            }
        }
        zip.finish().unwrap();
    }

    fn zip_names(path: &Path) -> Vec<String> {
        let zip = ZipArchive::new(File::open(path).unwrap()).unwrap();
        zip.file_names().map(|n| n.unwrap().into_owned()).collect()
    }

    #[test]
    fn export_then_import_gives_identical_files() {
        let src = project();
        let out = tempfile::tempdir().unwrap();
        let archive = out.path().join("Мельница.zip");
        export_zip(src.path(), &archive).unwrap();

        assert_eq!(
            zip_names(&archive),
            [
                "assets/cover.png",
                "data/boards/",
                "data/entities/a.json",
                "data/graphs/",
                "data/types.json",
                "documents/Мир/Диздок.md",
                "documents/Пусто/",
                "project.json",
            ]
        );

        let target = out.path().join("Копия");
        import_zip(&archive, &target).unwrap();
        assert_eq!(files_of(&target), files_of(src.path()));
        assert!(target.join("documents/Пусто").is_dir());
        for sub in crate::layout::LAYOUT_DIRS {
            assert!(target.join(sub).is_dir(), "{sub}");
        }
        assert!(!target.join(".herplan/workspace.json").exists());
        assert!(fs::read_dir(target.join("backups/auto"))
            .unwrap()
            .next()
            .is_none());
        // Nothing but the archive and the project next to them.
        assert_eq!(fs::read_dir(out.path()).unwrap().count(), 2);
    }

    #[test]
    fn imports_a_folder() {
        let src = project();
        let out = tempfile::tempdir().unwrap();
        let target = out.path().join("copy");
        fs::create_dir(&target).unwrap();
        import_folder(src.path(), &target).unwrap();
        assert_eq!(files_of(&target), files_of(src.path()));
        assert!(!target.join(".herplan/workspace.json").exists());
        assert!(!target.join("backups/auto/old.zip").exists());
        assert!(!target.join("data/.types.json.tmp-1").exists());
        assert!(target.join("documents/Пусто").is_dir());
    }

    #[test]
    fn import_folder_checks_source_and_target() {
        let src = project();
        let out = tempfile::tempdir().unwrap();
        let err = import_folder(out.path(), &out.path().join("t")).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotAProject);
        let err = import_folder(&out.path().join("none"), &out.path().join("t")).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        let busy = out.path().join("busy");
        fs::create_dir(&busy).unwrap();
        fs::write(busy.join("x"), "x").unwrap();
        let err = import_folder(src.path(), &busy).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotEmpty);
    }

    #[test]
    fn accepts_a_project_inside_one_top_level_folder() {
        let out = tempfile::tempdir().unwrap();
        let archive = out.path().join("nested.zip");
        write_zip(
            &archive,
            &[
                ("Мельница/", b""),
                ("Мельница/project.json", b"{}"),
                ("Мельница/data/entities/a.json", b"{\"id\":\"a\"}"),
                ("Мельница/backups/auto/x.zip", b"x"),
                ("Мельница/.herplan/cache.json", b"x"),
                ("__MACOSX/Мельница/._project.json", b"x"),
            ],
        );
        let target = out.path().join("p");
        import_zip(&archive, &target).unwrap();
        assert_eq!(fs::read(target.join("project.json")).unwrap(), b"{}");
        assert!(target.join("data/entities/a.json").is_file());
        assert!(!target.join("backups/auto/x.zip").exists());
        assert!(!target.join(".herplan/cache.json").exists());
        assert!(!target.join("Мельница").exists());
        assert!(!target.join("__MACOSX").exists());
    }

    #[test]
    fn rejects_unsafe_entry_names() {
        let out = tempfile::tempdir().unwrap();
        for evil in [
            "../evil.txt",
            "data/../../evil.txt",
            "/abs.txt",
            "C:/evil.txt",
            "data\\..\\..\\evil.txt",
            "documents/CON.md",
        ] {
            let archive = out.path().join("evil.zip");
            write_zip(&archive, &[("project.json", b"{}"), (evil, b"x")]);
            let target = out.path().join("t");
            let err = import_zip(&archive, &target).unwrap_err();
            assert_eq!(err.code, ErrorCode::BadArchive, "{evil}");
            assert!(!target.exists(), "{evil}");
            assert!(!out.path().join("evil.txt").exists());
        }
    }

    #[test]
    fn rejects_archives_without_a_project() {
        let out = tempfile::tempdir().unwrap();
        let archive = out.path().join("a.zip");
        write_zip(
            &archive,
            &[("notes/readme.md", b"x"), ("other/project.json", b"{}")],
        );
        let err = import_zip(&archive, &out.path().join("t")).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotAProject);

        let not_zip = out.path().join("b.zip");
        fs::write(&not_zip, b"definitely not a zip").unwrap();
        let err = import_zip(&not_zip, &out.path().join("t")).unwrap_err();
        assert_eq!(err.code, ErrorCode::BadArchive);

        let err = import_zip(&out.path().join("none.zip"), &out.path().join("t")).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
    }

    #[test]
    fn import_zip_refuses_occupied_targets() {
        let out = tempfile::tempdir().unwrap();
        let archive = out.path().join("a.zip");
        write_zip(&archive, &[("project.json", b"{}")]);
        let file = out.path().join("file");
        fs::write(&file, b"x").unwrap();
        assert_eq!(
            import_zip(&archive, &file).unwrap_err().code,
            ErrorCode::Exists
        );
        let busy = out.path().join("busy");
        fs::create_dir(&busy).unwrap();
        fs::write(busy.join("x"), b"x").unwrap();
        assert_eq!(
            import_zip(&archive, &busy).unwrap_err().code,
            ErrorCode::NotEmpty
        );
    }

    #[test]
    fn export_requires_a_project() {
        let out = tempfile::tempdir().unwrap();
        let err = export_zip(out.path(), &out.path().join("x.zip")).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotAProject);
    }
}
