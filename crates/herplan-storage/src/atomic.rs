use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const TEMP_MARKER: &str = ".tmp-";

/// The temporary file next to `target` that an atomic write goes through: `.<name>.tmp-<pid>`.
pub(crate) fn temp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    target.with_file_name(format!(".{name}{TEMP_MARKER}{}", std::process::id()))
}

/// True for names produced by [`temp_path`]; such files are never project content.
pub(crate) fn is_temp_name(name: &str) -> bool {
    name.starts_with('.') && name.contains(TEMP_MARKER)
}

/// Writes `payload` to `target` atomically: readers see either the old file or the new one.
pub fn write_atomic(target: &Path, payload: &[u8]) -> io::Result<()> {
    write_atomic_with(target, |f| f.write_all(payload))
}

/// Like [`write_atomic`], but the content is produced by `fill` (used for zip archives).
/// On failure the temporary file is removed, so a full disk leaves nothing behind.
pub(crate) fn write_atomic_with<E: From<io::Error>>(
    target: &Path,
    fill: impl FnOnce(&mut File) -> Result<(), E>,
) -> Result<(), E> {
    let tmp = temp_path(target);
    let result: Result<(), E> = (|| {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        fill(&mut f)?;
        f.sync_all()?;
        drop(f);
        rename_with_retry(&tmp, target)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result?;
    sync_parent(target).map_err(E::from)
}

/// Renames a file or folder. On Windows an antivirus scanner or the search indexer may hold a
/// file that was just written, which makes the rename fail for a moment; it is retried briefly.
pub(crate) fn rename_with_retry(from: &Path, to: &Path) -> io::Result<()> {
    const ATTEMPTS: u32 = if cfg!(windows) { 20 } else { 1 };
    let mut attempt = 1;
    loop {
        match fs::rename(from, to) {
            Err(e) if attempt < ATTEMPTS && e.kind() == io::ErrorKind::PermissionDenied => {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            result => return result,
        }
    }
}

#[cfg(unix)]
pub(crate) fn sync_parent(target: &Path) -> io::Result<()> {
    // On Unix the rename itself becomes durable only after the directory is synced.
    match target.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => fs::File::open(dir)?.sync_all(),
        _ => Ok(()),
    }
}

#[cfg(not(unix))]
pub(crate) fn sync_parent(_target: &Path) -> io::Result<()> {
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReadOutcome {
    Ok(Vec<u8>),
    Missing,
    /// The file exists but is empty: a write was cut short outside HErPlan's atomic path.
    Empty,
    Failed(String),
}

/// Reads a project file and classifies the obvious failure cases; content checks belong to the caller.
pub fn read_file(target: &Path) -> ReadOutcome {
    match fs::read(target) {
        Ok(b) if b.is_empty() => ReadOutcome::Empty,
        Ok(b) => ReadOutcome::Ok(b),
        Err(e) if e.kind() == io::ErrorKind::NotFound => ReadOutcome::Missing,
        Err(e) => ReadOutcome::Failed(e.to_string()),
    }
}

/// Deletes temporary files left behind by writes that were interrupted (crash, power loss).
/// Returns how many were removed. Called when a project is opened.
pub fn remove_stale_temp_files(dir: &Path) -> io::Result<usize> {
    remove_temp_files(dir, false)
}

/// Like [`remove_stale_temp_files`], but also in every subfolder.
pub fn remove_stale_temp_files_recursive(dir: &Path) -> io::Result<usize> {
    remove_temp_files(dir, true)
}

fn remove_temp_files(dir: &Path, recursive: bool) -> io::Result<usize> {
    let mut removed = 0;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if recursive && file_type.is_dir() {
            removed += remove_temp_files(&entry.path(), true)?;
        } else if file_type.is_file() && is_temp_name(&entry.file_name().to_string_lossy()) {
            fs::remove_file(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("project.json");
        assert_eq!(read_file(&file), ReadOutcome::Missing);
        write_atomic(&file, b"{\"v\":1}").unwrap();
        write_atomic(&file, "{\"имя\":\"Мира\"}".as_bytes()).unwrap();
        // Plain content, no header: other tools can read the file as is.
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"имя\":\"Мира\"}");
        assert_eq!(
            read_file(&file),
            ReadOutcome::Ok("{\"имя\":\"Мира\"}".as_bytes().to_vec())
        );
    }

    #[test]
    fn reports_empty_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.json");
        fs::write(&file, b"").unwrap();
        assert_eq!(read_file(&file), ReadOutcome::Empty);
    }

    #[test]
    fn cleans_up_interrupted_writes() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(".project.json.tmp-123"), b"partial").unwrap();
        fs::write(dir.path().join("keep.json"), b"x").unwrap();
        assert_eq!(remove_stale_temp_files(dir.path()).unwrap(), 1);
        assert!(dir.path().join("keep.json").exists());
    }

    #[test]
    fn cleans_up_nested_interrupted_writes() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("data").join("entities");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join(".a.json.tmp-1"), b"partial").unwrap();
        fs::write(dir.path().join(".b.json.tmp-2"), b"partial").unwrap();
        fs::write(nested.join("a.json"), b"{}").unwrap();
        assert_eq!(remove_stale_temp_files_recursive(dir.path()).unwrap(), 2);
        assert!(nested.join("a.json").exists());
    }

    #[test]
    fn failed_fill_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("a.zip");
        let result: io::Result<()> = write_atomic_with(&target, |f| {
            f.write_all(b"half")?;
            Err(io::Error::other("disk full"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn recognises_temp_names() {
        assert!(is_temp_name(".project.json.tmp-123"));
        assert!(!is_temp_name("project.json"));
        assert!(!is_temp_name("notes.tmp-1"));
    }
}
