//! The application settings file (`settings.json` in the per-user config folder).
//!
//! The interface owns its content; here it is only stored. A damaged file must not stop the
//! application from starting, so it is moved aside (kept for a bug report) and treated as absent.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::atomic::write_atomic;
use crate::clock::Utc;
use crate::error::{AtPath, Result, StorageError};

pub const SETTINGS_FILE: &str = "settings.json";

/// Raw settings text, or `None` when there is no file or it was damaged.
pub fn load_settings(config_dir: &Path) -> Result<Option<String>> {
    let path = config_dir.join(SETTINGS_FILE);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(StorageError::io(&e, &path)),
    };
    let text = String::from_utf8(bytes)
        .ok()
        .map(|t| t.trim_start_matches('\u{feff}').to_owned())
        .filter(|t| serde_json::from_str::<serde_json::Value>(t).is_ok());
    match text {
        Some(text) => Ok(Some(text)),
        None => {
            let damaged =
                config_dir.join(format!("settings.damaged-{}.json", Utc::now().file_stamp()));
            fs::rename(&path, &damaged).at(&path)?;
            Ok(None)
        }
    }
}

pub fn save_settings(config_dir: &Path, text: &str) -> Result<()> {
    fs::create_dir_all(config_dir).at(config_dir)?;
    let path = config_dir.join(SETTINGS_FILE);
    write_atomic(&path, text.as_bytes()).at(&path)
}

/// Saves a bug report as `report-<UTC stamp>.txt` in `reports_dir`; returns the file path.
/// Two reports within one second get `-2`, `-3`, so an earlier report is never overwritten.
pub fn save_report(reports_dir: &Path, text: &str) -> Result<PathBuf> {
    fs::create_dir_all(reports_dir).at(reports_dir)?;
    let stamp = Utc::now().file_stamp();
    let mut path = reports_dir.join(format!("report-{stamp}.txt"));
    let mut n = 1;
    while path.exists() {
        n += 1;
        path = reports_dir.join(format!("report-{stamp}-{n}.txt"));
    }
    write_atomic(&path, text.as_bytes()).at(&path)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn damaged_files(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("settings.damaged-") && n.ends_with(".json"))
            .collect()
    }

    #[test]
    fn saves_and_loads() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("io.github.herput0c.herplan");
        assert_eq!(load_settings(&dir).unwrap(), None);
        save_settings(&dir, "{\"language\":\"ru\"}").unwrap();
        assert_eq!(
            load_settings(&dir).unwrap().as_deref(),
            Some("{\"language\":\"ru\"}")
        );
    }

    #[test]
    fn moves_damaged_files_aside() {
        for content in [&b""[..], b"{\"language\":", b"\xff\xfe{}"] {
            let tmp = tempfile::tempdir().unwrap();
            let dir = tmp.path();
            fs::write(dir.join(SETTINGS_FILE), content).unwrap();
            assert_eq!(load_settings(dir).unwrap(), None);
            assert!(!dir.join(SETTINGS_FILE).exists());
            let damaged = damaged_files(dir);
            assert_eq!(damaged.len(), 1, "{content:?}");
            assert_eq!(fs::read(dir.join(&damaged[0])).unwrap(), content);
        }
    }

    #[test]
    fn saves_reports_without_overwriting() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("reports");
        let first = save_report(&dir, "one").unwrap();
        let second = save_report(&dir, "two").unwrap();
        assert_ne!(first, second);
        assert_eq!(fs::read_to_string(&first).unwrap(), "one");
        assert_eq!(fs::read_to_string(&second).unwrap(), "two");
    }
}
