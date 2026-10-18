use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const TEMP_MARKER: &str = ".tmp-";

fn temp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    target.with_file_name(format!(".{name}{TEMP_MARKER}{}", std::process::id()))
}

/// Writes `payload` to `target` atomically: readers see either the old file or the new one.
pub fn write_atomic(target: &Path, payload: &[u8]) -> io::Result<()> {
    let tmp = temp_path(target);
    {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        f.write_all(payload)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, target)?;
    sync_parent(target)
}

#[cfg(unix)]
fn sync_parent(target: &Path) -> io::Result<()> {
    // On Unix the rename itself becomes durable only after the directory is synced.
    match target.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => fs::File::open(dir)?.sync_all(),
        _ => Ok(()),
    }
}

#[cfg(not(unix))]
fn sync_parent(_target: &Path) -> io::Result<()> {
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
    let mut removed = 0;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') && name.contains(TEMP_MARKER) && entry.file_type()?.is_file() {
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
}
