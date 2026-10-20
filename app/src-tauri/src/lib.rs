//! HErPlan desktop shell: window, commands exposed to the interface, wiring to the storage crate.

mod commands;

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_version,
            commands::settings_load,
            commands::settings_save,
            commands::default_projects_dir,
            commands::join_path,
            commands::path_status,
            commands::project_create,
            commands::project_read,
            commands::project_read_file,
            commands::project_write,
            commands::project_import_file,
            commands::project_allow_assets,
            commands::asset_allow_file,
            commands::asset_list,
            commands::asset_mkdir,
            commands::asset_move,
            commands::asset_delete,
            commands::asset_import,
            commands::asset_write,
            commands::asset_open,
            commands::backup_create,
            commands::backup_list,
            commands::backup_prune,
            commands::backup_restore,
            commands::project_export_zip,
            commands::export_text,
            commands::project_import_zip,
            commands::project_import_folder,
            commands::system_info,
            commands::report_save,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start HErPlan");
}
