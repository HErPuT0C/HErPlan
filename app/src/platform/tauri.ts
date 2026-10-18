// Desktop platform: Rust commands of app/src-tauri plus the official dialog and opener plugins.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { BackupInfo, BackupKind, FileText, PathStatus, Platform, ProjectSnapshot } from './types';

type Filters = { name: string; extensions: string[] }[];

export class TauriPlatform implements Platform {
  readonly kind = 'tauri';
  private allowedAssetDirs = new Set<string>();

  appVersion(): Promise<string> {
    return invoke('app_version');
  }

  loadSettings(): Promise<string | null> {
    return invoke('settings_load');
  }

  saveSettings(text: string): Promise<void> {
    return invoke('settings_save', { text });
  }

  defaultProjectsDir(): Promise<string> {
    return invoke('default_projects_dir');
  }

  joinPath(...parts: string[]): Promise<string> {
    return invoke('join_path', { parts });
  }

  pathStatus(path: string): Promise<PathStatus> {
    return invoke('path_status', { path });
  }

  createProject(dir: string, files: FileText[]): Promise<void> {
    return invoke('project_create', { dir, files });
  }

  readProject(dir: string): Promise<ProjectSnapshot> {
    return invoke('project_read', { dir });
  }

  readProjectFile(dir: string, path: string): Promise<string | null> {
    return invoke('project_read_file', { dir, path });
  }

  writeProject(dir: string, writes: FileText[], deletes: string[]): Promise<void> {
    return invoke('project_write', { dir, writes, deletes });
  }

  importFile(dir: string, source: string, destDir: string): Promise<string> {
    return invoke('project_import_file', { dir, source, destDir });
  }

  async assetUrl(dir: string, path: string): Promise<string> {
    if (!this.allowedAssetDirs.has(dir)) {
      await invoke('project_allow_assets', { dir });
      this.allowedAssetDirs.add(dir);
    }
    return convertFileSrc(await this.joinPath(dir, ...path.split('/')));
  }

  async fileUrl(path: string): Promise<string> {
    await invoke('asset_allow_file', { path });
    return convertFileSrc(path);
  }

  createBackup(dir: string, kind: BackupKind, label: string | null): Promise<BackupInfo> {
    return invoke('backup_create', { dir, kind, label });
  }

  listBackups(dir: string): Promise<BackupInfo[]> {
    return invoke('backup_list', { dir });
  }

  pruneBackups(dir: string, keep: number | null): Promise<number> {
    return invoke('backup_prune', { dir, keep });
  }

  restoreBackup(dir: string, kind: BackupKind, name: string, safetyLabel: string): Promise<BackupInfo> {
    return invoke('backup_restore', { dir, kind, name, safetyLabel });
  }

  exportZip(dir: string, target: string): Promise<void> {
    return invoke('project_export_zip', { dir, target });
  }

  importZip(source: string, targetDir: string): Promise<void> {
    return invoke('project_import_zip', { source, targetDir });
  }

  importFolder(source: string, targetDir: string): Promise<void> {
    return invoke('project_import_folder', { source, targetDir });
  }

  async pickFolder(title: string, defaultPath?: string): Promise<string | null> {
    return open({ title, defaultPath, directory: true, multiple: false });
  }

  async pickFile(title: string, filters: Filters): Promise<string | null> {
    return open({ title, filters, directory: false, multiple: false });
  }

  async pickSaveFile(title: string, defaultPath: string, filters: Filters): Promise<string | null> {
    return save({ title, defaultPath, filters });
  }

  revealInExplorer(path: string): Promise<void> {
    return revealItemInDir(path);
  }

  openUrl(url: string): Promise<void> {
    return openUrl(url);
  }

  setUiScale(percent: number): Promise<void> {
    return getCurrentWebview().setZoom(percent / 100);
  }

  onWindowClose(handler: () => Promise<void>): void {
    // The window waits for the async handler, then closes (unless the event is prevented).
    void getCurrentWindow().onCloseRequested(async () => {
      try {
        await handler();
      } catch (e) {
        console.error('closing: work was not saved', e);
      }
    });
  }
}
