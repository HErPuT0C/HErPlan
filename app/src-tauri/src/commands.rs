//! Commands the interface calls with `invoke` (contract: app/src/platform/types.ts).
//!
//! Each command is a thin wrapper over `herplan-storage`. Disk work runs on the blocking thread
//! pool, so the window stays responsive while a large project is read or zipped. Tauri maps the
//! camelCase argument names of the interface (`destDir`) to these snake_case parameters.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

use herplan_storage::{
    self as storage, AssetEntry, BackupInfo, BackupKind, ErrorCode, FileText, PathStatus,
    ProjectSnapshot, StorageError,
};
use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::portable;

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

/// Where the settings file lives: the user's settings folder, or `data\settings` of the portable build.
fn settings_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    match portable::data_dir() {
        Some(data) => Ok(data.join("settings")),
        None => app.path().app_config_dir().map_err(shell_error),
    }
}

#[tauri::command]
pub async fn settings_load(app: AppHandle) -> CommandResult<Option<String>> {
    let dir = settings_dir(&app)?;
    blocking(move || storage::load_settings(&dir)).await
}

#[tauri::command]
pub async fn settings_save(app: AppHandle, text: String) -> CommandResult<()> {
    let dir = settings_dir(&app)?;
    blocking(move || storage::save_settings(&dir, &text)).await
}

/// `Documents\HErPlan` (`Projects` beside the portable build); created only when a project is created there.
#[tauri::command]
pub fn default_projects_dir(app: AppHandle) -> CommandResult<String> {
    if let Some(dir) = portable::projects_dir() {
        return Ok(dir.display().to_string());
    }
    let documents = app.path().document_dir().map_err(shell_error)?;
    Ok(documents.join("HErPlan").display().to_string())
}

/// The folder of the portable build, or nothing when the program is installed.
#[tauri::command]
pub fn portable_dir() -> Option<String> {
    portable::root().map(|r| r.display().to_string())
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

#[tauri::command]
pub async fn asset_list(dir: String) -> CommandResult<Vec<AssetEntry>> {
    let dir = absolute(&dir)?;
    blocking(move || storage::list_assets(&dir)).await
}

#[tauri::command]
pub async fn asset_mkdir(dir: String, path: String) -> CommandResult<()> {
    let dir = absolute(&dir)?;
    blocking(move || storage::asset_mkdir(&dir, &path)).await
}

#[tauri::command]
pub async fn asset_move(dir: String, from: String, to: String) -> CommandResult<()> {
    let dir = absolute(&dir)?;
    blocking(move || storage::asset_move(&dir, &from, &to)).await
}

/// Moves an asset to the Recycle Bin; with `force`, deletes it for good when the bin refuses.
#[tauri::command]
pub async fn asset_delete(dir: String, path: String, force: bool) -> CommandResult<()> {
    let dir = absolute(&dir)?;
    blocking(move || storage::asset_delete(&dir, &path, force)).await
}

#[tauri::command]
pub async fn asset_import(
    dir: String,
    sources: Vec<String>,
    dest_dir: String,
) -> CommandResult<Vec<String>> {
    let dir = absolute(&dir)?;
    let sources = sources
        .iter()
        .map(|s| absolute(s))
        .collect::<CommandResult<Vec<_>>>()?;
    blocking(move || storage::import_assets(&dir, &sources, &dest_dir)).await
}

/// Opens an asset file with its default program. Only files inside `assets/` of a project, and
/// not the kinds Windows would run (see `storage::asset_open_path`): the window cannot open
/// anything else, whatever path it sends.
#[tauri::command]
pub async fn asset_open(app: AppHandle, dir: String, path: String) -> CommandResult<()> {
    let dir = absolute(&dir)?;
    let target = blocking(move || storage::asset_open_path(&dir, &path)).await?;
    app.opener()
        .open_path(target.to_string_lossy(), None::<&str>)
        .map_err(|e| StorageError::new(ErrorCode::Io, e.to_string(), Some(&target)))
}

/// Saves bytes as a new asset. The bytes are the raw request body, so a pasted image does not
/// travel as a JSON array of numbers; the other arguments are percent-encoded headers.
#[tauri::command]
pub async fn asset_write(request: Request<'_>) -> CommandResult<String> {
    let data = body_bytes(request.body())
        .ok_or_else(|| StorageError::new(ErrorCode::Io, "the file content is not bytes", None))?;
    let dir = absolute(&header(&request, "x-herplan-dir")?)?;
    let dest_dir = header(&request, "x-herplan-dest-dir")?;
    let name = header(&request, "x-herplan-name")?;
    blocking(move || storage::write_asset(&dir, &dest_dir, &name, &data)).await
}

/// The bytes of a request body. The postMessage fallback of the IPC (used when the webview blocks
/// its custom protocol) delivers them as a JSON array instead of a raw body.
fn body_bytes(body: &InvokeBody) -> Option<Vec<u8>> {
    match body {
        InvokeBody::Raw(bytes) => Some(bytes.clone()),
        InvokeBody::Json(value) => value
            .as_array()?
            .iter()
            .map(|n| n.as_u64().and_then(|n| u8::try_from(n).ok()))
            .collect(),
    }
}

/// A percent-encoded request header (`encodeURIComponent` in the interface).
fn header(request: &Request<'_>, name: &str) -> CommandResult<String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(decode_header)
        .ok_or_else(|| {
            StorageError::new(
                ErrorCode::InvalidPath,
                format!("missing or malformed header {name}"),
                None,
            )
        })
}

fn decode_header(value: &str) -> Option<String> {
    percent_decode_str(value)
        .decode_utf8()
        .ok()
        .map(|value| value.into_owned())
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
pub async fn export_text(target: String, text: String) -> CommandResult<()> {
    let target = absolute(&target)?;
    blocking(move || storage::export_text(&target, &text)).await
}

/// Markdown export (Obsidian): the files go into a new or empty folder picked by the person.
#[tauri::command]
pub async fn export_files(target_dir: String, files: Vec<storage::FileText>) -> CommandResult<()> {
    let target_dir = absolute(&target_dir)?;
    blocking(move || storage::export_files(&target_dir, &files)).await
}

/// PDF export: the bytes are the raw request body, the target path a percent-encoded header.
#[tauri::command]
pub async fn export_bytes(request: Request<'_>) -> CommandResult<()> {
    let data = body_bytes(request.body())
        .ok_or_else(|| StorageError::new(ErrorCode::Io, "the file content is not bytes", None))?;
    let target = absolute(&header(&request, "x-herplan-target")?)?;
    blocking(move || storage::export_bytes(&target, &data)).await
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
        (
            "build".into(),
            if portable::root().is_some() {
                "portable"
            } else {
                "installed"
            }
            .into(),
        ),
    ])
}

/// Saves a bug report into a `reports` folder in the per-user data folder (in `data` of the portable build);
/// the interface reveals it.
#[tauri::command]
pub async fn report_save(app: AppHandle, text: String) -> CommandResult<String> {
    let dir = match portable::data_dir() {
        Some(data) => data,
        None => app.path().app_local_data_dir().map_err(shell_error)?,
    }
    .join("reports");
    blocking(move || storage::save_report(&dir, &text).map(|p| p.display().to_string())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_headers_written_with_encode_uri_component() {
        // encodeURIComponent("C:\\Users\\Мира\\Мельница (2)") in the interface.
        let encoded = "C%3A%5CUsers%5C%D0%9C%D0%B8%D1%80%D0%B0%5C%D0%9C%D0%B5%D0%BB%D1%8C%D0%BD%D0%B8%D1%86%D0%B0%20(2)";
        assert_eq!(
            decode_header(encoded).as_deref(),
            Some("C:\\Users\\Мира\\Мельница (2)")
        );
        assert_eq!(decode_header("%FF"), None, "not UTF-8");
    }

    #[test]
    fn reads_bytes_from_raw_and_json_bodies() {
        let raw = InvokeBody::Raw(vec![0, 137, 255]);
        assert_eq!(body_bytes(&raw), Some(vec![0, 137, 255]));
        let json = InvokeBody::Json("[0, 137, 255]".parse().unwrap());
        assert_eq!(body_bytes(&json), Some(vec![0, 137, 255]));
        for bad in ["[256]", "[-1]", "[1.5]", "{\"data\":[1]}", "\"AAEC\""] {
            let body = InvokeBody::Json(bad.parse().unwrap());
            assert_eq!(body_bytes(&body), None, "{bad}");
        }
    }
}
