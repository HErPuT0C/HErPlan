//! Shapes exchanged with the interface. They mirror `app/src/platform/types.ts` field for field;
//! a change here needs the same change there.

use serde::{Deserialize, Serialize};

/// A text file inside a project; `path` is relative and uses forward slashes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileText {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DamageReason {
    Empty,
    Unreadable,
    NotUtf8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DamagedFile {
    pub path: String,
    pub reason: DamageReason,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub path: String,
    pub size: u64,
    pub modified_ms: u64,
}

/// Everything the interface needs to open a project: JSON and Markdown as text, assets as a listing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub files: Vec<FileText>,
    pub damaged: Vec<DamagedFile>,
    pub assets: Vec<AssetInfo>,
    pub removed_temp_files: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PathStatus {
    Missing,
    EmptyDir,
    NonEmptyDir,
    File,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackupKind {
    Auto,
    Manual,
}

impl BackupKind {
    /// Folder name under `backups/`.
    pub fn dir_name(self) -> &'static str {
        match self {
            BackupKind::Auto => "auto",
            BackupKind::Manual => "manual",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub kind: BackupKind,
    /// File name without extension, e.g. "2026-10-18T09-40-00Z".
    pub name: String,
    pub created_at: String,
    pub size: u64,
    pub label: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_to_the_typescript_shapes() {
        let snapshot = ProjectSnapshot {
            files: vec![FileText {
                path: "project.json".into(),
                text: "{}".into(),
            }],
            damaged: vec![DamagedFile {
                path: "data/a.json".into(),
                reason: DamageReason::NotUtf8,
                detail: None,
            }],
            assets: vec![AssetInfo {
                path: "assets/a.png".into(),
                size: 3,
                modified_ms: 1_700_000_000_000,
            }],
            removed_temp_files: 2,
        };
        assert_eq!(
            serde_json::to_value(&snapshot).unwrap(),
            json!({
                "files": [{ "path": "project.json", "text": "{}" }],
                "damaged": [{ "path": "data/a.json", "reason": "not-utf8", "detail": null }],
                "assets": [{ "path": "assets/a.png", "size": 3, "modifiedMs": 1_700_000_000_000u64 }],
                "removedTempFiles": 2
            })
        );

        let info = BackupInfo {
            kind: BackupKind::Manual,
            name: "2026-10-18T09-40-00Z".into(),
            created_at: "2026-10-18T09:40:00Z".into(),
            size: 10,
            label: None,
        };
        assert_eq!(
            serde_json::to_value(&info).unwrap(),
            json!({ "kind": "manual", "name": "2026-10-18T09-40-00Z", "createdAt": "2026-10-18T09:40:00Z", "size": 10, "label": null })
        );

        let statuses = [
            PathStatus::Missing,
            PathStatus::EmptyDir,
            PathStatus::NonEmptyDir,
            PathStatus::File,
        ];
        assert_eq!(
            serde_json::to_value(statuses).unwrap(),
            json!(["missing", "empty-dir", "non-empty-dir", "file"])
        );
        assert_eq!(
            serde_json::to_value([DamageReason::Empty, DamageReason::Unreadable]).unwrap(),
            json!(["empty", "unreadable"])
        );
    }

    #[test]
    fn deserializes_arguments_from_the_interface() {
        let kind: BackupKind = serde_json::from_str("\"auto\"").unwrap();
        assert_eq!(kind, BackupKind::Auto);
        let file: FileText = serde_json::from_str(r#"{"path":"data/a.json","text":"x"}"#).unwrap();
        assert_eq!(file.path, "data/a.json");
    }
}
