//! Commands the interface calls with `invoke` (contract: app/src/platform/types.ts).
//!
//! Each command is a thin wrapper over `herplan-storage`. Disk work runs on the blocking thread
//! pool, so the window stays responsive while a large project is read or zipped. Tauri maps the
//! camelCase argument names of the interface (`destDir`) to these snake_case parameters.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use herplan_storage::{
    self as storage, BackupInfo, BackupKind, ErrorCode, FileText, PathStatus, ProjectSnapshot,
    StorageError,
};
use tauri::{AppHandle, Manager};

type CommandResult<T> = Result<T, StorageError>;

/// One disk operation at a time. On Windows a file being zipped by a backup cannot be replaced
/// by a save at the same moment, so operations are queued instead of failing.
static DISK: Mutex<()> = Mutex::new(());

async fn blocking<T, F>(work: F) -> CommandResult<T>
where
    F: FnOnce() -> CommandResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let _turn = DISK.lock().unwrap_or_else(PoisonError::into_inner);
        work()
    })
    .await
    .map_err(shell_error)?
}

fn shell_error(err: tauri::Error) -> StorageError {
    StorageError::new(ErrorCode::Io, err.to_string(), None)
}

fn absolute(path: &str) -> CommandResult<PathBuf> {
    storage::require_absolute(path)
}

#[tauri::command]
pub async fn settings_load(app: AppHandle) -> CommandResult<Option<String>> {
    let dir = app.path().app_config_dir().map_err(shell_error)?;
    blocking(move || storage::load_settings(&dir)).await
}

#[tauri::command]
pub async fn settings_save(app: AppHandle, text: String) -> CommandResult<()> {
    let dir = app.path().app_config_dir().map_err(shell_error)?;
    blocking(move || storage::save_settings(&dir, &text)).await
}

/// `Documents\HErPlan`; created only when a project is created there.
#[tauri::command]
pub fn default_projects_dir(app: AppHandle) -> CommandResult<String> {
    let documents = app.path().document_dir().map_err(shell_error)?;
    Ok(documents.join("HErPlan").display().to_string())
}

#[tauri::command]
pub fn join_path(parts: Vec<String>) -> String {
    parts.iter().collect::<PathBuf>().display().to_string()
}

#[tauri::command]
pub async fn path_status(path: String) -> CommandResult<PathStatus> {
    let path = absolute(&path)?;
    blocking(move || storage::path_status(&path)).await
}

#[tauri::command]
pub async fn project_create(dir: String, files: Vec<FileText>) -> CommandResult<()> {
    let dir = absolute(&dir)?;
    blocking(move || storage::create_project(&dir, &files)).await
}

#[tauri::command]
pub async fn project_read(dir: String) -> CommandResult<ProjectSnapshot> {
    let dir = absolute(&dir)?;
    blocking(move || storage::read_project(&dir)).await
}

#[tauri::command]
pub async fn project_read_file(dir: String, path: String) -> CommandResult<Option<String>> {
    let dir = absolute(&dir)?;
    blocking(move || storage::read_project_file(&dir, &path)).await
}

#[tauri::command]
pub async fn project_write(
    dir: String,
    writes: Vec<FileText>,
    deletes: Vec<String>,
) -> CommandResult<()> {
    let dir = absolute(&dir)?;
    blocking(move || storage::write_project(&dir, &writes, &deletes)).await
}

#[tauri::command]
pub async fn project_import_file(
    dir: String,
    source: String,
    dest_dir: String,
) -> CommandResult<String> {
    let dir = absolute(&dir)?;
    let source = absolute(&source)?;
    blocking(move || storage::import_file(&dir, &source, &dest_dir)).await
}

/// Lets `<img>` show files of the open project through the asset protocol. The scope starts empty
/// (tauri.conf.json), so the interface can reach only the folders of projects it opened.
#[tauri::command]
pub fn project_allow_assets(app: AppHandle, dir: String) -> CommandResult<()> {
    let dir = absolute(&dir)?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(shell_error)
}

/// Lets `<img>` show one outside file the user just picked, e.g. a cover before the project exists.
#[tauri::command]
pub fn asset_allow_file(app: AppHandle, path: String) -> CommandResult<()> {
    let path = absolute(&path)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(shell_error)
}

#[tauri::command]
pub async fn backup_create(
    dir: String,
    kind: BackupKind,
    label: Option<String>,
) -> CommandResult<BackupInfo> {
    let dir = absolute(&dir)?;
    blocking(move || storage::create_backup(&dir, kind, label.as_deref())).await
}

#[tauri::command]
pub async fn backup_list(dir: String) -> CommandResult<Vec<BackupInfo>> {
    let dir = absolute(&dir)?;
    blocking(move || storage::list_backups(&dir)).await
}

#[tauri::command]
pub async fn backup_prune(dir: String, keep: Option<u32>) -> CommandResult<u32> {
    let dir = absolute(&dir)?;
    blocking(move || storage::prune_backups(&dir, keep)).await
}

#[tauri::command]
pub async fn backup_restore(
    dir: String,
    kind: BackupKind,
    name: String,
    safety_label: String,
) -> CommandResult<BackupInfo> {
    let dir = absolute(&dir)?;
    blocking(move || storage::restore_backup(&dir, kind, &name, &safety_label)).await
}

#[tauri::command]
pub async fn project_export_zip(dir: String, target: String) -> CommandResult<()> {
    let dir = absolute(&dir)?;
    let target = absolute(&target)?;
    blocking(move || storage::export_zip(&dir, &target)).await
}

#[tauri::command]
pub async fn project_import_zip(source: String, target_dir: String) -> CommandResult<()> {
    let source = absolute(&source)?;
    let target_dir = absolute(&target_dir)?;
    blocking(move || storage::import_zip(&source, &target_dir)).await
}

#[tauri::command]
pub async fn project_import_folder(source: String, target_dir: String) -> CommandResult<()> {
    let source = absolute(&source)?;
    let target_dir = absolute(&target_dir)?;
    blocking(move || storage::import_folder(&source, &target_dir)).await
}

/// Versions and environment for bug reports (FR-APP-07).
#[tauri::command]
pub fn system_info(app: AppHandle) -> BTreeMap<String, String> {
    let webview = tauri::webview_version().unwrap_or_else(|e| format!("unknown ({e})"));
    BTreeMap::from([
        ("app".into(), app.package_info().version.to_string()),
        ("tauri".into(), tauri::VERSION.into()),
        ("webview".into(), webview),
        ("os".into(), os_info::get().to_string()),
        ("arch".into(), std::env::consts::ARCH.into()),
    ])
}

/// Saves a bug report into a `reports` folder in the per-user data folder; the interface reveals it.
#[tauri::command]
pub async fn report_save(app: AppHandle, text: String) -> CommandResult<String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(shell_error)?
        .join("reports");
    blocking(move || storage::save_report(&dir, &text).map(|p| p.display().to_string())).await
}
