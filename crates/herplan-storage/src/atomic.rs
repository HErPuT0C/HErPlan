use sha2::{Digest, Sha256};
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

/// Writes `payload` to `target` atomically, prefixed with a `sha256:<hex>` header line.
pub fn write_atomic(target: &Path, payload: &[u8]) -> io::Result<()> {
    let tmp = temp_path(target);
    {
        let mut f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        writeln!(f, "sha256:{:x}", Sha256::digest(payload))?;
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
    Valid(Vec<u8>),
    Missing,
    Corrupt(String),
}

/// Reads a file written by [`write_atomic`] and verifies its checksum.
pub fn read_verified(target: &Path) -> ReadOutcome {
    let bytes = match fs::read(target) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return ReadOutcome::Missing,
        Err(e) => return ReadOutcome::Corrupt(e.to_string()),
    };
    let Some(nl) = bytes.iter().position(|&b| b == b'\n') else {
        return ReadOutcome::Corrupt(format!("no checksum header ({} bytes)", bytes.len()));
    };
    let expected = String::from_utf8_lossy(&bytes[..nl]);
    let payload = &bytes[nl + 1..];
    let actual = format!("sha256:{:x}", Sha256::digest(payload));
    if expected.trim_end() == actual {
        ReadOutcome::Valid(payload.to_vec())
    } else {
        ReadOutcome::Corrupt(format!("checksum mismatch ({} bytes)", payload.len()))
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
        assert_eq!(read_verified(&file), ReadOutcome::Missing);
        write_atomic(&file, b"{\"v\":1}").unwrap();
        write_atomic(&file, "{\"имя\":\"Мира\"}".as_bytes()).unwrap();
        assert_eq!(
            read_verified(&file),
            ReadOutcome::Valid("{\"имя\":\"Мира\"}".as_bytes().to_vec())
        );
    }

    #[test]
    fn detects_damage() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.json");
        fs::write(&file, b"").unwrap();
        assert!(matches!(read_verified(&file), ReadOutcome::Corrupt(_)));
        write_atomic(&file, b"{}").unwrap();
        let mut bytes = fs::read(&file).unwrap();
        *bytes.last_mut().unwrap() = b']';
        fs::write(&file, bytes).unwrap();
        assert!(matches!(read_verified(&file), ReadOutcome::Corrupt(_)));
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
