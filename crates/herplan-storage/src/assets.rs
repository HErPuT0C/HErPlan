//! The asset library: the user's own files and folders under `assets/`.
//!
//! Every path from the interface must lie inside `assets/`, so these operations cannot reach
//! project data, `backups/` or `.herplan/`. Temporary files of interrupted writes are neither
//! listed nor addressable. Folders belong to the user here: they are listed even when empty and
//! stay when their last file is moved or deleted, as in the file explorer.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::atomic::{is_temp_name, rename_with_retry, temp_path, write_atomic};
use crate::clock::unix_ms;
use crate::error::{AtPath, ErrorCode, Result, StorageError};
use crate::layout::require_project;
use crate::model::{AssetEntry, AssetKind};
use crate::paths::{is_valid_name, to_slash, validate_asset_path, ASSETS_DIR};
use crate::write::{copy_atomic, free_folder_name, free_name};

/// Files that Windows and macOS put into folders by themselves (thumbnail caches, folder view
/// settings), in lower case.
const SYSTEM_FILES: &[&str] = &[
    "thumbs.db",
    "ehthumbs.db",
    "ehthumbs_vista.db",
    "desktop.ini",
    ".ds_store",
];

/// Every file and folder under `assets/` (the folder itself excluded), sorted by path. Folders
/// are listed even when empty. A symlink to a file counts as that file; symlinked folders are
/// skipped, which rules out cycles.
pub fn list_assets(dir: &Path) -> Result<Vec<AssetEntry>> {
    require_project(dir)?;
    let root = dir.join(ASSETS_DIR);
    let mut out = Vec::new();
    // A project made by hand may lack the folder; its library is then empty.
    if root.is_dir() {
        list_folder(&root, ASSETS_DIR, &mut out)?;
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn list_folder(folder: &Path, rel: &str, out: &mut Vec<AssetEntry>) -> Result<()> {
    for entry in fs::read_dir(folder).at(folder)? {
        let entry = entry.at(folder)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_temp_name(&name) {
            continue;
        }
        let abs = entry.path();
        let is_symlink = entry.file_type().at(&abs)?.is_symlink();
        // For a plain entry the directory listing already has the metadata (on Windows at no cost).
        let meta = if is_symlink {
            fs::metadata(&abs)
        } else {
            entry.metadata()
        };
        let meta = match meta {
            Ok(meta) if is_symlink && !meta.is_file() => continue,
            Ok(meta) => meta,
            // Deleted since the folder was read (e.g. by a sync client), or a broken symlink.
            Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
            Err(e) => return Err(StorageError::io(&e, &abs)),
        };
        let path = format!("{rel}/{name}");
        let modified_ms = meta.modified().map(unix_ms).unwrap_or(0);
        if meta.is_dir() {
            out.push(AssetEntry {
                path: path.clone(),
                kind: AssetKind::Folder,
                size: 0,
                modified_ms,
            });
            list_folder(&abs, &path, out)?;
        } else if meta.is_file() {
            out.push(AssetEntry {
                path,
                kind: AssetKind::File,
                size: meta.len(),
                modified_ms,
            });
        }
    }
    Ok(())
}

/// Creates a folder under `assets/` with any missing parents. An existing folder is not an error;
/// a file in the way fails with `exists`.
pub fn asset_mkdir(dir: &Path, rel: &str) -> Result<()> {
    let rel = validate_asset_path(rel, false)?;
    require_project(dir)?;
    create_folder(dir, &rel)
}

/// Creates `<dir>/<rel>` with missing parents. A file that has the name of one of the folders
/// fails with `exists`, where `create_dir_all` would report an OS error that differs by system.
fn create_folder(dir: &Path, rel: &Path) -> Result<()> {
    let mut current = dir.to_path_buf();
    for part in rel.components() {
        current.push(part);
        match fs::metadata(&current) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => return Err(name_taken(&current)),
            // Everything below a missing folder is missing too.
            Err(e) if e.kind() == io::ErrorKind::NotFound => break,
            Err(e) => return Err(StorageError::io(&e, &current)),
        }
    }
    let target = dir.join(rel);
    fs::create_dir_all(&target).at(&target)
}

fn name_taken(path: &Path) -> StorageError {
    StorageError::new(ErrorCode::Exists, "the name is taken", Some(path))
}

/// Renames or moves a file, or a folder with its contents, within `assets/`, creating missing
/// parents of `to`. Fails with `exists` when `to` is taken and with `invalid-path` when a folder
/// would move into itself or one of its subfolders.
pub fn asset_move(dir: &Path, from: &str, to: &str) -> Result<()> {
    let from_rel = validate_asset_path(from, false)?;
    let to_rel = validate_asset_path(to, false)?;
    require_project(dir)?;
    let source = dir.join(&from_rel);
    fs::symlink_metadata(&source).at(&source)?;
    if from_rel == to_rel {
        return Ok(());
    }
    if moves_into_itself(dir, &from_rel, &to_rel) {
        return Err(StorageError::invalid_path(to));
    }
    let target = dir.join(&to_rel);
    if fs::symlink_metadata(&target).is_ok() {
        // On Windows `a.png` and `A.png` name the same file, so a change of letter case looks
        // like a move onto an existing file.
        if equal_ignoring_case(&from_rel, &to_rel) && same_entry(&source, &target) {
            return rename_via_temp(&source, &target);
        }
        return Err(name_taken(&target));
    }
    if let Some(parent) = to_rel.parent() {
        create_folder(dir, parent)?;
    }
    rename_with_retry(&source, &target).at(&source)
}

/// True when `to` lies inside `from`. A prefix that differs only in letter case counts when it
/// is the same folder on disk, as on Windows.
fn moves_into_itself(dir: &Path, from: &Path, to: &Path) -> bool {
    let depth = from.components().count();
    if to.components().count() <= depth {
        return false;
    }
    let prefix: PathBuf = to.components().take(depth).collect();
    prefix == from
        || (equal_ignoring_case(&prefix, from) && same_entry(&dir.join(from), &dir.join(&prefix)))
}

fn equal_ignoring_case(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

/// True when both paths name the same file or folder on disk.
#[cfg(unix)]
fn same_entry(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
        (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
        _ => false,
    }
}

/// True when both paths name the same file or folder on disk.
#[cfg(not(unix))]
fn same_entry(a: &Path, b: &Path) -> bool {
    // The file index is not on stable Rust; the canonical path carries the case stored on disk.
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Renames through a temporary name next to the target: Windows does not rename a file onto
/// itself, which is what `a.png` → `A.png` is there.
fn rename_via_temp(source: &Path, target: &Path) -> Result<()> {
    let tmp = temp_path(target);
    rename_with_retry(source, &tmp).at(source)?;
    if let Err(e) = rename_with_retry(&tmp, target) {
        // Put the item back under its old name rather than leave it hidden under a temporary one.
        let _ = rename_with_retry(&tmp, source);
        return Err(StorageError::io(&e, target));
    }
    Ok(())
}

/// Extensions Windows runs rather than shows: "open in Windows" refuses them, so a file that
/// came into the asset library from elsewhere cannot start a program. Lower case.
const RUNNABLE: &[&str] = &[
    "exe",
    "com",
    "bat",
    "cmd",
    "msi",
    "msp",
    "mst",
    "ps1",
    "psm1",
    "psd1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "wsc",
    "scr",
    "pif",
    "lnk",
    "url",
    "reg",
    "hta",
    "cpl",
    "jar",
    "msc",
    "application",
    "appref-ms",
    "gadget",
    "inf",
    "sct",
    "dll",
    "sys",
    "scf",
    "library-ms",
    "settingcontent-ms",
    "diagcab",
    "xll",
    "chm",
];

/// The absolute path of an asset file to open with its default program: a file (not a folder)
/// inside `assets/` of a project, whose kind Windows shows rather than runs.
pub fn asset_open_path(dir: &Path, rel: &str) -> Result<PathBuf> {
    let rel = validate_asset_path(rel, false)?;
    require_project(dir)?;
    let target = dir.join(&rel);
    let meta = fs::metadata(&target).map_err(|e| StorageError::io(&e, &target))?;
    if !meta.is_file() {
        return Err(StorageError::invalid_path(&to_slash(&rel)));
    }
    let ext = target
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if RUNNABLE.contains(&ext.as_str()) {
        return Err(StorageError::new(
            ErrorCode::InvalidPath,
            format!("files of type .{ext} are not opened from HErPlan"),
            Some(&target),
        ));
    }
    Ok(target)
}

/// Moves a file, or a folder with its contents, to the Recycle Bin. When the bin refuses (a
/// network drive, a Linux machine without a trash folder), the item is deleted for good only with
/// `force`; otherwise nothing changes and the error is `io`. A missing path is not an error.
pub fn asset_delete(dir: &Path, rel: &str, force: bool) -> Result<()> {
    delete_with(dir, rel, force, move_to_trash)
}

/// The system Recycle Bin. Tests pass their own instead, so they do not fill the real one.
fn move_to_trash(path: &Path) -> std::result::Result<(), String> {
    // The crate unwraps some COM results on Windows; a panic must not take the command with it.
    match std::panic::catch_unwind(|| trash::delete(path)) {
        Ok(result) => result.map_err(|e| e.to_string()),
        Err(_) => Err("the Recycle Bin call panicked".to_owned()),
    }
}

fn delete_with(
    dir: &Path,
    rel: &str,
    force: bool,
    to_bin: impl FnOnce(&Path) -> std::result::Result<(), String>,
) -> Result<()> {
    let rel = validate_asset_path(rel, false)?;
    require_project(dir)?;
    let target = dir.join(&rel);
    match fs::symlink_metadata(&target) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(StorageError::io(&e, &target)),
        Ok(_) => {}
    }
    let reason = match to_bin(&target) {
        Ok(()) => return Ok(()),
        Err(reason) => reason,
    };
    if !force {
        return Err(StorageError::new(
            ErrorCode::Io,
            format!("could not move to the Recycle Bin: {reason}"),
            Some(&target),
        ));
    }
    // The bin may have taken part of a folder before it gave up.
    match fs::symlink_metadata(&target) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(StorageError::io(&e, &target)),
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(&target).at(&target),
        Ok(_) => fs::remove_file(&target).at(&target),
    }
}

/// Copies outside files and folders into `dest_dir` (a folder under `assets/`, created if
/// missing), keeping the structure of folders, empty ones included. A clash of names gives
/// ` (2)`, ` (3)`… as in [`crate::import_file`]: before the extension of a file, after the name of
/// a folder. Symlinks, temporary files and the files Windows and macOS put into folders by
/// themselves (`Thumbs.db`, `desktop.ini`…) are skipped. Returns the project-relative paths of
/// the copied files.
///
/// All sources are read before the first copy, so a missing source or a name the project cannot
/// hold fails the import with nothing copied, and a folder imported into itself cannot loop. A
/// failure while copying removes what this import created.
pub fn import_assets(dir: &Path, sources: &[PathBuf], dest_dir: &str) -> Result<Vec<String>> {
    let dest_rel = validate_asset_path(dest_dir, true)?;
    require_project(dir)?;
    let mut items = Vec::new();
    for source in sources {
        items.extend(read_source(source)?);
    }
    create_folder(dir, &dest_rel)?;
    let dest = dir.join(&dest_rel);
    let mut copied = Vec::new();
    let mut created = Vec::new();
    for item in &items {
        let target = item.free_target(&dest);
        created.push(target.clone());
        if let Err(err) = copy_source(item, &target, &dest_rel, &mut copied) {
            for path in created.iter().rev() {
                remove_quietly(path);
            }
            return Err(err);
        }
    }
    Ok(copied)
}

/// A source file or folder, read in full before anything is copied.
enum Source {
    File { path: PathBuf, name: String },
    Folder { name: String, children: Vec<Source> },
}

impl Source {
    /// A name in `into` that nothing has yet.
    fn free_target(&self, into: &Path) -> PathBuf {
        match self {
            Source::File { name, .. } => free_name(into, name),
            Source::Folder { name, .. } => free_folder_name(into, name),
        }
    }
}

/// Reads a source and, for a folder, everything inside it; `None` for what is skipped.
fn read_source(path: &Path) -> Result<Option<Source>> {
    let meta = fs::symlink_metadata(path).at(path)?;
    let lossy_name = path.file_name().unwrap_or_default().to_string_lossy();
    let skipped = meta.file_type().is_symlink()
        || !(meta.is_file() || meta.is_dir())
        || is_system_file(&lossy_name, &meta);
    if skipped {
        return Ok(None);
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| is_valid_name(n))
        .ok_or_else(|| StorageError::invalid_path(&path.display().to_string()))?
        .to_owned();
    if meta.is_file() {
        return Ok(Some(Source::File {
            path: path.to_path_buf(),
            name,
        }));
    }
    let mut entries = fs::read_dir(path)
        .at(path)?
        .map(|entry| entry.map(|e| e.path()))
        .collect::<io::Result<Vec<_>>>()
        .at(path)?;
    // Sorted, so the copied paths come back in a stable order.
    entries.sort();
    let mut children = Vec::new();
    for entry in entries {
        children.extend(read_source(&entry)?);
    }
    Ok(Some(Source::Folder { name, children }))
}

/// Leftovers of interrupted writes and files the system puts into folders by itself: never what
/// the user meant to import.
fn is_system_file(name: &str, meta: &fs::Metadata) -> bool {
    is_temp_name(name)
        || SYSTEM_FILES.contains(&name.to_lowercase().as_str())
        || is_hidden_system(meta)
}

/// Hidden system files, such as `desktop.ini`, or `$RECYCLE.BIN` when a whole drive is dropped.
#[cfg(windows)]
fn is_hidden_system(meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    // FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM
    const HIDDEN_SYSTEM: u32 = 0x2 | 0x4;
    meta.file_attributes() & HIDDEN_SYSTEM == HIDDEN_SYSTEM
}

#[cfg(not(windows))]
fn is_hidden_system(_meta: &fs::Metadata) -> bool {
    false
}

/// Copies `source` to `target` (a free name in a folder whose project-relative path is
/// `parent_rel`) and adds the path of every copied file to `copied`.
fn copy_source(
    source: &Source,
    target: &Path,
    parent_rel: &Path,
    copied: &mut Vec<String>,
) -> Result<()> {
    let rel = parent_rel.join(target.file_name().unwrap_or_default());
    match source {
        Source::File { path, .. } => {
            copy_atomic(path, target)?;
            copied.push(to_slash(&rel));
        }
        Source::Folder { children, .. } => {
            fs::create_dir(target).at(target)?;
            for child in children {
                copy_source(child, &child.free_target(target), &rel, copied)?;
            }
        }
    }
    Ok(())
}

/// Removes what a failed import created. Best effort: the error that stopped the import is the
/// one to report.
fn remove_quietly(path: &Path) {
    let _ = match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(_) => Ok(()),
    };
}

/// Saves bytes, e.g. an image pasted from the clipboard, as a new file `name` in `dest_dir` (a
/// folder under `assets/`, created if missing). A clash of names gives `name (2).ext`… as in an
/// import. Returns the project-relative path of the file.
pub fn write_asset(dir: &Path, dest_dir: &str, name: &str, data: &[u8]) -> Result<String> {
    let dest_rel = validate_asset_path(dest_dir, true)?;
    if !is_valid_name(name) {
        return Err(StorageError::invalid_path(name));
    }
    require_project(dir)?;
    create_folder(dir, &dest_rel)?;
    let target = free_name(&dir.join(&dest_rel), name);
    write_atomic(&target, data).at(&target)?;
    Ok(to_slash(
        &dest_rel.join(target.file_name().unwrap_or_default()),
    ))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::model::FileText;

    fn project() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        crate::layout::create_project(
            tmp.path(),
            &[FileText {
                path: "project.json".into(),
                text: "{}".into(),
            }],
        )
        .unwrap();
        tmp
    }

    fn put(root: &Path, rel: &str, bytes: &[u8]) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn opens_only_viewable_files_inside_assets() {
        let tmp = project();
        put(tmp.path(), "assets/world/mira.png", b"png");
        put(tmp.path(), "assets/tools/setup.EXE", b"MZ");
        put(tmp.path(), "assets/tools/run.bat", b"echo");
        assert_eq!(
            asset_open_path(tmp.path(), "assets/world/mira.png").unwrap(),
            tmp.path().join("assets").join("world").join("mira.png")
        );
        for rel in [
            "assets/tools/setup.EXE",
            "assets/tools/run.bat",
            "assets/world",
            "project.json",
        ] {
            let err = asset_open_path(tmp.path(), rel).expect_err(rel);
            assert_eq!(err.code, ErrorCode::InvalidPath, "{rel}");
        }
        assert_eq!(
            asset_open_path(tmp.path(), "assets/none.png")
                .unwrap_err()
                .code,
            ErrorCode::NotFound
        );
        // Not a project: nothing is opened.
        let plain = tempfile::tempdir().unwrap();
        put(plain.path(), "assets/a.png", b"png");
        assert!(asset_open_path(plain.path(), "assets/a.png").is_err());
    }

    /// The library as (path, kind) pairs, in listing order.
    fn listing(dir: &Path) -> Vec<(String, AssetKind)> {
        list_assets(dir)
            .unwrap()
            .into_iter()
            .map(|e| (e.path, e.kind))
            .collect()
    }

    fn file(path: &str) -> (String, AssetKind) {
        (path.to_owned(), AssetKind::File)
    }

    fn folder(path: &str) -> (String, AssetKind) {
        (path.to_owned(), AssetKind::Folder)
    }

    /// Every file under `root` with its content, by path relative to `root`.
    fn files_under(root: &Path) -> BTreeMap<String, Vec<u8>> {
        fn walk(dir: &Path, rel: &str, out: &mut BTreeMap<String, Vec<u8>>) {
            for entry in fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                let name = entry.file_name().to_string_lossy().into_owned();
                let child = if rel.is_empty() {
                    name
                } else {
                    format!("{rel}/{name}")
                };
                if entry.file_type().unwrap().is_dir() {
                    walk(&entry.path(), &child, out);
                } else {
                    out.insert(child, fs::read(entry.path()).unwrap());
                }
            }
        }
        let mut out = BTreeMap::new();
        walk(root, "", &mut out);
        out
    }

    fn assert_code<T: std::fmt::Debug>(result: Result<T>, code: ErrorCode, what: &str) {
        assert_eq!(result.unwrap_err().code, code, "{what}");
    }

    #[test]
    fn lists_files_and_folders_without_temp_files() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/cover.png", b"12345");
        put(dir, "assets/Мир/Персонажи/Мира.png", b"1");
        put(dir, "assets/Мир/Персонажи/.Мира.png.tmp-7", b"partial");
        put(dir, "assets/.renamed.tmp-3/inside.png", b"x");
        fs::create_dir_all(dir.join("assets/empty/deeper")).unwrap();
        put(dir, "data/entities/a.json", b"{}");
        put(dir, "backups/auto/x.zip", b"x");

        let entries = list_assets(dir).unwrap();
        let paths: Vec<_> = entries.iter().map(|e| (e.path.clone(), e.kind)).collect();
        assert_eq!(
            paths,
            vec![
                file("assets/cover.png"),
                folder("assets/empty"),
                folder("assets/empty/deeper"),
                folder("assets/Мир"),
                folder("assets/Мир/Персонажи"),
                file("assets/Мир/Персонажи/Мира.png"),
            ]
        );
        assert_eq!(entries[0].size, 5);
        assert!(entries[0].modified_ms > 0);
        assert_eq!(entries[1].size, 0);
        assert!(entries[1].modified_ms > 0);
    }

    #[cfg(unix)]
    #[test]
    fn lists_symlinked_files_but_not_symlinked_folders() {
        let tmp = project();
        let dir = tmp.path();
        let outside = tempfile::tempdir().unwrap();
        put(outside.path(), "pic.png", b"abc");
        put(outside.path(), "folder/a.png", b"a");
        std::os::unix::fs::symlink(outside.path().join("pic.png"), dir.join("assets/link.png"))
            .unwrap();
        std::os::unix::fs::symlink(outside.path().join("folder"), dir.join("assets/linked"))
            .unwrap();
        std::os::unix::fs::symlink(outside.path().join("gone"), dir.join("assets/broken")).unwrap();
        // A link to its own parent would loop forever if it were followed.
        std::os::unix::fs::symlink(dir.join("assets"), dir.join("assets/loop")).unwrap();
        let entries = list_assets(dir).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "assets/link.png");
        assert_eq!(entries[0].size, 3);
    }

    #[test]
    fn lists_an_empty_library_and_refuses_non_projects() {
        let tmp = project();
        assert!(list_assets(tmp.path()).unwrap().is_empty());
        fs::remove_dir(tmp.path().join("assets")).unwrap();
        assert!(list_assets(tmp.path()).unwrap().is_empty());

        let empty = tempfile::tempdir().unwrap();
        assert_code(
            list_assets(empty.path()),
            ErrorCode::NotAProject,
            "no project.json",
        );
        assert_code(
            list_assets(&empty.path().join("gone")),
            ErrorCode::NotFound,
            "missing folder",
        );
    }

    #[test]
    fn makes_folders() {
        let tmp = project();
        let dir = tmp.path();
        asset_mkdir(dir, "assets/Мир/Персонажи").unwrap();
        assert!(dir.join("assets/Мир/Персонажи").is_dir());
        // Making an existing folder again is fine.
        asset_mkdir(dir, "assets/Мир").unwrap();
        asset_mkdir(dir, "assets/Мир/Персонажи").unwrap();
        assert_eq!(
            listing(dir),
            vec![folder("assets/Мир"), folder("assets/Мир/Персонажи")]
        );

        put(dir, "assets/a.png", b"x");
        assert_code(
            asset_mkdir(dir, "assets/a.png"),
            ErrorCode::Exists,
            "file there",
        );
        let err = asset_mkdir(dir, "assets/a.png/sub").unwrap_err();
        assert_eq!(err.code, ErrorCode::Exists);
        assert!(err.path.unwrap().ends_with("a.png"));
        assert_eq!(fs::read(dir.join("assets/a.png")).unwrap(), b"x");

        // The assets folder itself is recreated when a hand-made project lacks it.
        fs::remove_dir_all(dir.join("assets")).unwrap();
        asset_mkdir(dir, "assets/new").unwrap();
        assert!(dir.join("assets/new").is_dir());
    }

    #[test]
    fn every_operation_stays_inside_assets() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/a.png", b"a");
        put(dir, "data/types.json", b"{}");
        put(dir, "assets/.a.png.tmp-1", b"partial");
        let outside = tempfile::tempdir().unwrap();
        put(outside.path(), "x.png", b"x");
        let source = vec![outside.path().join("x.png")];
        let bad = [
            "assets",
            "data/types.json",
            "data",
            "project.json",
            "backups/auto",
            ".herplan",
            "assets/../data/types.json",
            "assets/../../escape",
            "../outside",
            "assets/./a.png",
            "/assets/a.png",
            "assets/.a.png.tmp-1",
            "",
        ];
        for path in bad {
            assert_code(asset_mkdir(dir, path), ErrorCode::InvalidPath, path);
            assert_code(
                asset_move(dir, path, "assets/b.png"),
                ErrorCode::InvalidPath,
                path,
            );
            assert_code(
                asset_move(dir, "assets/a.png", path),
                ErrorCode::InvalidPath,
                path,
            );
            assert_code(
                delete_with(dir, path, true, |_| unreachable!("checked first")),
                ErrorCode::InvalidPath,
                path,
            );
        }
        for dest in [
            "data",
            "assets/..",
            "../assets",
            "backups",
            "",
            "assets/.x.tmp-1",
        ] {
            assert_code(
                import_assets(dir, &source, dest),
                ErrorCode::InvalidPath,
                dest,
            );
            assert_code(
                write_asset(dir, dest, "b.png", b"b"),
                ErrorCode::InvalidPath,
                dest,
            );
        }
        assert_eq!(fs::read(dir.join("data/types.json")).unwrap(), b"{}");
        assert_eq!(listing(dir), vec![file("assets/a.png")]);
    }

    #[test]
    fn moves_and_renames_files() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/Мир/a.png", b"a");
        asset_move(dir, "assets/Мир/a.png", "assets/Мир/b.png").unwrap();
        asset_move(dir, "assets/Мир/b.png", "assets/new/deeper/b.png").unwrap();
        assert_eq!(fs::read(dir.join("assets/new/deeper/b.png")).unwrap(), b"a");
        // The emptied folder stays, as in the file explorer.
        assert_eq!(
            listing(dir),
            vec![
                folder("assets/new"),
                folder("assets/new/deeper"),
                file("assets/new/deeper/b.png"),
                folder("assets/Мир"),
            ]
        );
        // Moving onto itself changes nothing.
        asset_move(dir, "assets/new/deeper/b.png", "assets/new/deeper/b.png").unwrap();
        assert!(dir.join("assets/new/deeper/b.png").is_file());
    }

    #[test]
    fn moves_folders_with_their_contents() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/Мир/Персонажи/Мира.png", b"m");
        put(dir, "assets/Мир/фон.png", b"f");
        fs::create_dir_all(dir.join("assets/Мир/пусто")).unwrap();
        asset_move(dir, "assets/Мир", "assets/Архив/Мир 1").unwrap();
        assert_eq!(
            listing(dir),
            vec![
                folder("assets/Архив"),
                folder("assets/Архив/Мир 1"),
                folder("assets/Архив/Мир 1/Персонажи"),
                file("assets/Архив/Мир 1/Персонажи/Мира.png"),
                folder("assets/Архив/Мир 1/пусто"),
                file("assets/Архив/Мир 1/фон.png"),
            ]
        );
        assert_eq!(
            fs::read(dir.join("assets/Архив/Мир 1/Персонажи/Мира.png")).unwrap(),
            b"m"
        );
    }

    #[test]
    fn changes_letter_case() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/a.png", b"a");
        put(dir, "assets/pics/b.png", b"b");
        asset_move(dir, "assets/a.png", "assets/A.png").unwrap();
        asset_move(dir, "assets/pics", "assets/Pics").unwrap();
        assert_eq!(
            listing(dir),
            vec![
                file("assets/A.png"),
                folder("assets/Pics"),
                file("assets/Pics/b.png")
            ]
        );
        assert_eq!(fs::read(dir.join("assets/A.png")).unwrap(), b"a");
    }

    #[test]
    fn renames_through_a_temporary_name() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/a.png", b"a");
        put(dir, "assets/pics/b.png", b"b");
        rename_via_temp(&dir.join("assets/a.png"), &dir.join("assets/A.png")).unwrap();
        rename_via_temp(&dir.join("assets/pics"), &dir.join("assets/Pics")).unwrap();
        assert_eq!(
            files_under(&dir.join("assets")),
            BTreeMap::from([
                ("A.png".to_owned(), b"a".to_vec()),
                ("Pics/b.png".to_owned(), b"b".to_vec()),
            ])
        );
        // A failed rename leaves the item under its old name, with no temporary file.
        let err =
            rename_via_temp(&dir.join("assets/A.png"), &dir.join("assets/none/A.png")).unwrap_err();
        assert_eq!(err.code, ErrorCode::NotFound);
        assert_eq!(fs::read(dir.join("assets/A.png")).unwrap(), b"a");
        assert_eq!(fs::read_dir(dir.join("assets")).unwrap().count(), 2);
    }

    #[test]
    fn refuses_taken_targets_and_moves_into_itself() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/a.png", b"a");
        put(dir, "assets/b.png", b"b");
        put(dir, "assets/Мир/c.png", b"c");
        put(dir, "assets/Мир2/d.png", b"d");

        assert_code(
            asset_move(dir, "assets/a.png", "assets/b.png"),
            ErrorCode::Exists,
            "file onto file",
        );
        assert_code(
            asset_move(dir, "assets/a.png", "assets/Мир"),
            ErrorCode::Exists,
            "file onto folder",
        );
        assert_code(
            asset_move(dir, "assets/Мир", "assets/Мир2"),
            ErrorCode::Exists,
            "folder onto folder",
        );
        assert_code(
            asset_move(dir, "assets/Мир2/d.png", "assets/a.png/d.png"),
            ErrorCode::Exists,
            "a file where the parent folder would be",
        );
        assert_code(
            asset_move(dir, "assets/Мир", "assets/Мир/Мир"),
            ErrorCode::InvalidPath,
            "into itself",
        );
        assert_code(
            asset_move(dir, "assets/Мир", "assets/Мир/a/b"),
            ErrorCode::InvalidPath,
            "into its subfolder",
        );
        assert_code(
            asset_move(dir, "assets/none.png", "assets/x.png"),
            ErrorCode::NotFound,
            "missing source",
        );
        // A folder whose name starts like the source's is not inside it.
        asset_move(dir, "assets/Мир", "assets/Мир2/Мир").unwrap();
        assert_eq!(
            files_under(&dir.join("assets")),
            BTreeMap::from([
                ("a.png".to_owned(), b"a".to_vec()),
                ("b.png".to_owned(), b"b".to_vec()),
                ("Мир2/d.png".to_owned(), b"d".to_vec()),
                ("Мир2/Мир/c.png".to_owned(), b"c".to_vec()),
            ])
        );
    }

    #[test]
    fn deletes_through_the_bin() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/a.png", b"a");
        let calls = AtomicUsize::new(0);
        let fake_bin = |path: &Path| {
            calls.fetch_add(1, Ordering::SeqCst);
            fs::remove_file(path).map_err(|e| e.to_string())
        };
        delete_with(dir, "assets/a.png", false, fake_bin).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!dir.join("assets/a.png").exists());
        // Already gone: nothing to do, the bin is not asked.
        delete_with(dir, "assets/a.png", false, |_| unreachable!("missing")).unwrap();
    }

    #[test]
    fn deletes_for_good_only_when_forced() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/Мир/Персонажи/Мира.png", b"m");
        put(dir, "assets/Мир/фон.png", b"f");
        put(dir, "assets/a.png", b"a");
        let no_bin = |_: &Path| Err("no trash folder".to_owned());

        let err = delete_with(dir, "assets/Мир", false, no_bin).unwrap_err();
        assert_eq!(err.code, ErrorCode::Io);
        assert!(err.message.contains("no trash folder"), "{}", err.message);
        assert!(dir.join("assets/Мир/Персонажи/Мира.png").is_file());

        delete_with(dir, "assets/Мир", true, no_bin).unwrap();
        delete_with(dir, "assets/a.png", true, no_bin).unwrap();
        assert!(listing(dir).is_empty());
        assert!(dir.join("assets").is_dir(), "the root folder stays");
    }

    #[test]
    fn deleting_the_last_file_keeps_its_folder() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/Мир/a.png", b"a");
        delete_with(dir, "assets/Мир/a.png", true, |_| Err("no bin".into())).unwrap();
        assert_eq!(listing(dir), vec![folder("assets/Мир")]);
    }

    #[test]
    fn imports_files_and_folders_with_numbered_names() {
        let tmp = project();
        let dir = tmp.path();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path();
        put(src, "cover.png", b"png");
        put(src, "README", b"text");
        put(src, "Pics/a.png", b"a");
        put(src, "v1.2/b.png", b"b");

        let sources = [
            src.join("cover.png"),
            src.join("README"),
            src.join("Pics"),
            src.join("v1.2"),
        ];
        assert_eq!(
            import_assets(dir, &sources, "assets").unwrap(),
            vec![
                "assets/cover.png",
                "assets/README",
                "assets/Pics/a.png",
                "assets/v1.2/b.png"
            ]
        );
        assert_eq!(
            import_assets(dir, &sources, "assets").unwrap(),
            vec![
                "assets/cover (2).png",
                "assets/README (2)",
                "assets/Pics (2)/a.png",
                "assets/v1.2 (2)/b.png"
            ]
        );
        assert_eq!(
            import_assets(dir, &sources[..1], "assets\\Новая/папка").unwrap(),
            vec!["assets/Новая/папка/cover.png"]
        );
        assert_eq!(fs::read(dir.join("assets/Pics (2)/a.png")).unwrap(), b"a");
        assert_eq!(fs::read(dir.join("assets/cover (2).png")).unwrap(), b"png");
        // The sources are untouched.
        assert_eq!(files_under(src).len(), 4);
    }

    #[test]
    fn imports_a_large_nested_folder_completely() {
        let tmp = project();
        let dir = tmp.path();
        let outside = tempfile::tempdir().unwrap();
        let dropped = outside.path().join("Картинки");
        let mut expected = BTreeMap::new();
        for i in 0..250 {
            let rel = match i % 5 {
                0 => format!("{i:03}.png"),
                1 => format!("Персонажи/{i:03}.png"),
                2 => format!("Персонажи/Главные/{i:03}.png"),
                3 => format!("Локации/Город/Ночь/{i:03}.jpg"),
                _ => format!("Локации/{i:03} копия.png"),
            };
            let bytes = format!("picture {i}").into_bytes();
            put(&dropped, &rel, &bytes);
            expected.insert(format!("Картинки/{rel}"), bytes);
        }
        fs::create_dir_all(dropped.join("Локации/Пусто")).unwrap();
        put(&dropped, "Thumbs.db", b"cache");
        put(&dropped, "Персонажи/desktop.ini", b"[.ShellClassInfo]");
        put(&dropped, "Персонажи/.DS_Store", b"mac");
        put(&dropped, "Локации/.a.png.tmp-4", b"partial");

        let copied = import_assets(dir, &[dropped], "assets/Импорт").unwrap();
        assert_eq!(copied.len(), 250);
        let mut sorted = copied.clone();
        sorted.sort();
        assert_eq!(copied, sorted, "stable order");
        assert!(copied
            .iter()
            .all(|p| p.starts_with("assets/Импорт/Картинки/")));

        assert_eq!(files_under(&dir.join("assets/Импорт")), expected);
        assert!(dir.join("assets/Импорт/Картинки/Локации/Пусто").is_dir());
        let listed = list_assets(dir).unwrap();
        let files = listed.iter().filter(|e| e.kind == AssetKind::File).count();
        assert_eq!(files, 250);
        assert!(listed
            .iter()
            .any(|e| e.path == "assets/Импорт/Картинки/Локации/Пусто"));
    }

    #[cfg(unix)]
    #[test]
    fn import_skips_symlinks() {
        let tmp = project();
        let dir = tmp.path();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path();
        put(src, "real/a.png", b"a");
        put(src, "secret.txt", b"secret");
        std::os::unix::fs::symlink(src.join("secret.txt"), src.join("real/link.txt")).unwrap();
        std::os::unix::fs::symlink(src, src.join("real/loop")).unwrap();
        std::os::unix::fs::symlink(src.join("real"), src.join("top-link")).unwrap();

        let copied =
            import_assets(dir, &[src.join("real"), src.join("top-link")], "assets").unwrap();
        assert_eq!(copied, vec!["assets/real/a.png"]);
        assert_eq!(
            files_under(&dir.join("assets"))
                .into_keys()
                .collect::<Vec<_>>(),
            vec!["real/a.png"]
        );
    }

    #[test]
    fn import_checks_every_source_before_copying() {
        let tmp = project();
        let dir = tmp.path();
        let outside = tempfile::tempdir().unwrap();
        put(outside.path(), "a.png", b"a");
        let sources = [
            outside.path().join("a.png"),
            outside.path().join("gone.png"),
        ];
        assert_code(
            import_assets(dir, &sources, "assets/new"),
            ErrorCode::NotFound,
            "missing source",
        );
        assert!(!dir.join("assets/new").exists());
        assert!(listing(dir).is_empty());

        put(dir, "assets/file.png", b"x");
        assert_code(
            import_assets(dir, &sources[..1], "assets/file.png"),
            ErrorCode::Exists,
            "destination is a file",
        );
        assert_code(
            import_assets(dir, &sources[..1], "assets/file.png/sub"),
            ErrorCode::Exists,
            "a file inside the destination path",
        );
    }

    #[test]
    fn imports_a_folder_into_itself_without_looping() {
        let tmp = project();
        let dir = tmp.path();
        put(dir, "assets/Мир/a.png", b"a");
        let copied = import_assets(dir, &[dir.join("assets/Мир")], "assets/Мир").unwrap();
        assert_eq!(copied, vec!["assets/Мир/Мир/a.png"]);
        assert_eq!(
            files_under(&dir.join("assets"))
                .into_keys()
                .collect::<Vec<_>>(),
            vec!["Мир/a.png", "Мир/Мир/a.png"]
        );
    }

    #[test]
    fn writes_bytes_as_new_files() {
        let tmp = project();
        let dir = tmp.path();
        let png = [0x89, b'P', b'N', b'G', 0, 1, 2, 0xFF];
        assert_eq!(
            write_asset(dir, "assets", "Вставка.png", &png).unwrap(),
            "assets/Вставка.png"
        );
        assert_eq!(
            write_asset(dir, "assets", "Вставка.png", b"second").unwrap(),
            "assets/Вставка (2).png"
        );
        assert_eq!(
            write_asset(dir, "assets/Мир/Новая", "a.png", b"").unwrap(),
            "assets/Мир/Новая/a.png"
        );
        assert_eq!(fs::read(dir.join("assets/Вставка.png")).unwrap(), png);
        assert_eq!(
            fs::read(dir.join("assets/Вставка (2).png")).unwrap(),
            b"second"
        );
        for name in [
            "",
            "a/b.png",
            "a\\b.png",
            "..",
            "con.png",
            "a?.png",
            "a.png.",
            ".a.png.tmp-1",
        ] {
            assert_code(
                write_asset(dir, "assets", name, b"x"),
                ErrorCode::InvalidPath,
                name,
            );
        }
        let names: Vec<String> = fs::read_dir(dir.join("assets"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().all(|n| !n.contains(".tmp-")), "{names:?}");
    }

    #[test]
    fn refuses_folders_that_are_not_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        assert_code(
            asset_mkdir(dir, "assets/a"),
            ErrorCode::NotAProject,
            "mkdir",
        );
        assert_code(
            write_asset(dir, "assets", "a.png", b"a"),
            ErrorCode::NotAProject,
            "write",
        );
        assert_code(
            import_assets(&dir.join("gone"), &[], "assets"),
            ErrorCode::NotFound,
            "vanished project folder",
        );
        assert!(!dir.join("assets").exists());
        assert!(!dir.join("gone").exists());
    }
}
