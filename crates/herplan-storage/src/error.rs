//! Errors reported to the interface. The interface shows its own localized text by `code`;
//! `message` is the English OS message, kept for logs and bug reports.

use std::fmt;
use std::io;
use std::path::Path;

use serde::Serialize;

/// What went wrong, in terms the interface can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorCode {
    DiskFull,
    NotFound,
    Exists,
    NotEmpty,
    NotAProject,
    InvalidPath,
    PermissionDenied,
    BadArchive,
    Io,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageError {
    pub code: ErrorCode,
    pub message: String,
    pub path: Option<String>,
}

pub type Result<T> = std::result::Result<T, StorageError>;

impl StorageError {
    pub fn new(code: ErrorCode, message: impl Into<String>, path: Option<&Path>) -> Self {
        Self {
            code,
            message: message.into(),
            path: path.map(|p| p.display().to_string()),
        }
    }

    /// Wraps an OS error, keeping the path it happened on.
    pub fn io(err: &io::Error, path: &Path) -> Self {
        Self::new(code_for(err), err.to_string(), Some(path))
    }

    pub(crate) fn invalid_path(path: &str) -> Self {
        Self {
            code: ErrorCode::InvalidPath,
            message: format!("invalid path: {path:?}"),
            path: Some(path.to_owned()),
        }
    }

    pub(crate) fn not_a_project(dir: &Path) -> Self {
        Self::new(
            ErrorCode::NotAProject,
            "no project.json in the folder",
            Some(dir),
        )
    }

    pub(crate) fn bad_archive(message: impl Into<String>, archive: &Path) -> Self {
        Self::new(ErrorCode::BadArchive, message, Some(archive))
    }

    /// Fills in `path` when the error was created without one.
    pub(crate) fn or_path(mut self, path: &Path) -> Self {
        if self.path.is_none() {
            self.path = Some(path.display().to_string());
        }
        self
    }
}

/// For generic helpers such as `write_atomic_with`; callers add the path with [`StorageError::or_path`].
impl From<io::Error> for StorageError {
    fn from(err: io::Error) -> Self {
        Self::new(code_for(&err), err.to_string(), None)
    }
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.path {
            Some(path) => write!(f, "{}: {}", path, self.message),
            None => f.write_str(&self.message),
        }
    }
}

impl std::error::Error for StorageError {}

/// Classifies an OS error. Disk-full gets its own code because the interface must tell the user
/// that nothing was saved and why, instead of a generic failure.
pub fn code_for(err: &io::Error) -> ErrorCode {
    if is_disk_full(err) {
        return ErrorCode::DiskFull;
    }
    match err.kind() {
        io::ErrorKind::NotFound => ErrorCode::NotFound,
        io::ErrorKind::PermissionDenied => ErrorCode::PermissionDenied,
        io::ErrorKind::AlreadyExists => ErrorCode::Exists,
        _ => ErrorCode::Io,
    }
}

fn is_disk_full(err: &io::Error) -> bool {
    // ERROR_HANDLE_DISK_FULL and ERROR_DISK_FULL on Windows, ENOSPC elsewhere. The standard
    // library already maps them to StorageFull; the raw codes are a fallback for older mappings.
    #[cfg(windows)]
    const DISK_FULL: &[i32] = &[39, 112];
    #[cfg(not(windows))]
    const DISK_FULL: &[i32] = &[28];
    err.kind() == io::ErrorKind::StorageFull
        || err.raw_os_error().is_some_and(|c| DISK_FULL.contains(&c))
}

/// Attaches the path an I/O operation was working on.
pub(crate) trait AtPath<T> {
    fn at(self, path: &Path) -> Result<T>;
}

impl<T> AtPath<T> for io::Result<T> {
    fn at(self, path: &Path) -> Result<T> {
        self.map_err(|e| StorageError::io(&e, path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_os_errors_to_codes() {
        #[cfg(windows)]
        let disk_full = [39, 112];
        #[cfg(not(windows))]
        let disk_full = [28];
        for code in disk_full {
            let err = io::Error::from_raw_os_error(code);
            assert_eq!(code_for(&err), ErrorCode::DiskFull, "os error {code}");
        }
        let cases = [
            (io::ErrorKind::NotFound, ErrorCode::NotFound),
            (io::ErrorKind::PermissionDenied, ErrorCode::PermissionDenied),
            (io::ErrorKind::AlreadyExists, ErrorCode::Exists),
            (io::ErrorKind::StorageFull, ErrorCode::DiskFull),
            (io::ErrorKind::InvalidData, ErrorCode::Io),
        ];
        for (kind, code) in cases {
            assert_eq!(code_for(&io::Error::from(kind)), code, "{kind:?}");
        }
    }

    #[test]
    fn maps_raw_not_found_and_access_denied() {
        #[cfg(windows)]
        let (not_found, denied) = (2, 5);
        #[cfg(not(windows))]
        let (not_found, denied) = (2, 13);
        let err = io::Error::from_raw_os_error(not_found);
        assert_eq!(code_for(&err), ErrorCode::NotFound);
        let err = io::Error::from_raw_os_error(denied);
        assert_eq!(code_for(&err), ErrorCode::PermissionDenied);
    }

    #[test]
    fn serializes_like_the_interface_expects() {
        let err = StorageError::io(
            &io::Error::from(io::ErrorKind::StorageFull),
            Path::new("p/project.json"),
        );
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "disk-full");
        assert_eq!(json["path"], "p/project.json");
        assert!(json["message"].is_string());

        let err = StorageError::new(ErrorCode::NotAProject, "x", None);
        assert_eq!(
            serde_json::to_string(&err).unwrap(),
            r#"{"code":"not-a-project","message":"x","path":null}"#
        );
    }
}
