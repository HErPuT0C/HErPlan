//! Atomic file replacement for project data.
//!
//! The new content goes to a temporary file in the same directory, is flushed to disk, and then
//! replaces the target with a rename. A crash at any point leaves either the old or the new file,
//! never a truncated one. Each file carries a SHA-256 of its payload so a reader can tell a torn
//! write (which should be impossible) from a valid one.

use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

fn temp_path(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.tmp-{}", std::process::id()))
}

/// Writes `payload` to `target` atomically, with a checksum header line.
pub fn write_atomic(target: &Path, payload: &[u8]) -> io::Result<()> {
    let tmp = temp_path(target);
    {
        let mut f = OpenOptions::new().write(true).create(true).truncate(true).open(&tmp)?;
        let digest = Sha256::digest(payload);
        writeln!(f, "sha256:{digest:x}")?;
        f.write_all(payload)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, target)?;
    sync_parent(target)
}

#[cfg(unix)]
fn sync_parent(target: &Path) -> io::Result<()> {
    // On Unix the rename itself must be made durable by syncing the directory.
    if let Some(dir) = target.parent() {
        File::open(dir)?.sync_all()?;
    }
    Ok(())
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
        return ReadOutcome::Corrupt(format!("no header ({} bytes)", bytes.len()));
    };
    let header = String::from_utf8_lossy(&bytes[..nl]);
    let payload = &bytes[nl + 1..];
    let expected = header.strip_prefix("sha256:").unwrap_or("");
    let actual = format!("{:x}", Sha256::digest(payload));
    if expected == actual {
        ReadOutcome::Valid(payload.to_vec())
    } else {
        ReadOutcome::Corrupt(format!("checksum mismatch ({} bytes)", payload.len()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_overwrite() {
        let dir = std::env::temp_dir().join(format!("herplan-storage-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("project.json");
        assert_eq!(read_verified(&file), ReadOutcome::Missing);
        write_atomic(&file, b"{\"v\":1}").unwrap();
        write_atomic(&file, b"{\"v\":2}").unwrap();
        assert_eq!(read_verified(&file), ReadOutcome::Valid(b"{\"v\":2}".to_vec()));
        fs::write(&file, b"sha256:00\n{}").unwrap();
        assert!(matches!(read_verified(&file), ReadOutcome::Corrupt(_)));
        fs::remove_dir_all(&dir).unwrap();
    }
}
