//! Project storage for HErPlan (ADR-004, docs/format/project-v1.md).
//!
//! Every project file is replaced atomically: the new content goes to a temporary file next to the
//! target, is flushed to disk, and then renamed over the target. A crash at any point leaves either
//! the old or the new file, never a truncated one.
//!
//! Files stay plain JSON and plain Markdown, so other tools (git, Obsidian, a text editor) can read
//! and edit them. Damage is detected by the reader (a JSON file that does not parse, an empty file),
//! not by checksums: a changed checksum would also flag legitimate edits made outside HErPlan.
//!
//! This crate has no Tauri dependency; the desktop shell wraps these functions in commands.

mod archive;
mod assets;
mod atomic;
mod backup;
mod clock;
mod error;
mod layout;
mod model;
mod paths;
mod settings;
mod snapshot;
mod walk;
mod write;

pub use archive::{export_text, export_zip, import_folder, import_zip};
pub use assets::{asset_delete, asset_mkdir, asset_move, import_assets, list_assets, write_asset};
pub use atomic::{
    read_file, remove_stale_temp_files, remove_stale_temp_files_recursive, write_atomic,
    ReadOutcome,
};
pub use backup::{create_backup, list_backups, prune_backups, restore_backup};
pub use error::{code_for, ErrorCode, Result, StorageError};
pub use layout::{create_project, ensure_layout, path_status, LAYOUT_DIRS};
pub use model::{
    AssetEntry, AssetInfo, AssetKind, BackupInfo, BackupKind, DamageReason, DamagedFile, FileText,
    PathStatus, ProjectSnapshot,
};
pub use paths::{require_absolute, validate_rel_path, PROJECT_FILE};
pub use settings::{load_settings, save_report, save_settings, SETTINGS_FILE};
pub use snapshot::{read_project, read_project_file};
pub use write::{import_file, write_project};
