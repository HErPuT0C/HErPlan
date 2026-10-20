// Desktop platform: Rust commands of app/src-tauri plus the official dialog and opener plugins.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getCurrentWebview, type DragDropEvent } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { AssetEntry, BackupInfo, BackupKind, FileText, PathStatus, Platform, ProjectSnapshot } from './types';

type Filters = { name: string; extensions: string[] }[];

/**
 * Native drag positions are physical pixels; the page works in CSS pixels. `devicePixelRatio` covers both the
 * Windows display scale and the interface zoom (WebView2 zoom acts like browser zoom).
 */
function toCssPixels(position: { x: number; y: number }): { x: number; y: number } {
  const scale = window.devicePixelRatio || 1;
  return { x: position.x / scale, y: position.y / scale };
}

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

  listAssets(dir: string): Promise<AssetEntry[]> {
    return invoke('asset_list', { dir });
  }

  assetMkdir(dir: string, path: string): Promise<void> {
    return invoke('asset_mkdir', { dir, path });
  }

  assetMove(dir: string, from: string, to: string): Promise<void> {
    return invoke('asset_move', { dir, from, to });
  }

  assetDelete(dir: string, path: string, force = false): Promise<void> {
    return invoke('asset_delete', { dir, path, force });
  }

  importAssets(dir: string, sources: string[], destDir: string): Promise<string[]> {
    return invoke('asset_import', { dir, sources, destDir });
  }

  writeAsset(dir: string, destDir: string, name: string, data: Uint8Array): Promise<string> {
    // The bytes go as the raw request body instead of a JSON array of numbers; the other arguments go in
    // headers, which carry ASCII only, hence the encoding.
    return invoke('asset_write', data, {
      headers: {
        'x-herplan-dir': encodeURIComponent(dir),
        'x-herplan-dest-dir': encodeURIComponent(destDir),
        'x-herplan-name': encodeURIComponent(name),
      },
    });
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

  exportText(target: string, text: string): Promise<void> {
    return invoke('export_text', { target, text });
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

  async pickFiles(title: string): Promise<string[]> {
    return (await open({ title, directory: false, multiple: true })) ?? [];
  }

  async pickSaveFile(title: string, defaultPath: string, filters: Filters): Promise<string | null> {
    return save({ title, defaultPath, filters });
  }

  revealInExplorer(path: string): Promise<void> {
    return revealItemInDir(path);
  }

  openAsset(dir: string, path: string): Promise<void> {
    return invoke('asset_open', { dir, path });
  }

  openUrl(url: string): Promise<void> {
    return openUrl(url);
  }

  onFileDrop(handler: (paths: string[], x: number, y: number) => void): () => void {
    return this.onDragDrop((event) => {
      if (event.type !== 'drop') return;
      const { x, y } = toCssPixels(event.position);
      handler(event.paths, x, y);
    });
  }

  onFileDragOver(handler: (point: { x: number; y: number } | null) => void): () => void {
    return this.onDragDrop((event) => {
      handler(event.type === 'enter' || event.type === 'over' ? toCssPixels(event.position) : null);
    });
  }

  /** Listens to the webview's native drag and drop; the returned function works even before listening starts. */
  private onDragDrop(handler: (event: DragDropEvent) => void): () => void {
    let stopped = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!stopped) handler(event.payload);
      })
      .then(
        (stop) => {
          if (stopped) stop();
          else unlisten = stop;
        },
        (e: unknown) => console.error('file drop: cannot listen', e),
      );
    return () => {
      stopped = true;
      unlisten?.();
    };
  }

  setUiScale(percent: number): Promise<void> {
    return getCurrentWebview().setZoom(percent / 100);
  }

  systemInfo(): Promise<Record<string, string>> {
    return invoke('system_info');
  }

  saveReport(text: string): Promise<string> {
    return invoke('report_save', { text });
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
