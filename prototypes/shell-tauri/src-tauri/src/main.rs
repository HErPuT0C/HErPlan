// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Where CI measurements are written: HERPLAN_REPORT_PATH, or herplan-report.json in the working directory.
fn report_path() -> PathBuf {
    std::env::var_os("HERPLAN_REPORT_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("herplan-report.json"))
}

#[tauri::command]
fn report(json: String) -> Result<(), String> {
    std::fs::write(report_path(), json).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    let autobench = std::env::args().any(|a| a == "--autobench");
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![report, quit])
        .setup(move |app| {
            let page = if autobench { "index.html#autobench" } else { "index.html" };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App(page.into()))
                .title("HErPlan — прототип (Tauri)")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 640.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run HErPlan prototype");
}
