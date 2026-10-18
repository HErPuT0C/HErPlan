// Thin bridge to whichever desktop shell hosts the prototype (Tauri, Electron or a plain browser).

export interface ShellBridge {
  name: 'tauri' | 'electron' | 'browser';
  version: string;
  // Writes a JSON report next to the executable (used by CI measurements).
  report(data: unknown): Promise<void>;
  quit(): Promise<void>;
}

interface ElectronApi {
  versions: Record<string, string>;
  report(json: string): Promise<void>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    herplanElectron?: ElectronApi;
  }
}

export async function detectShell(): Promise<ShellBridge> {
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { getVersion, getTauriVersion } = await import('@tauri-apps/api/app');
    const [app, tauri] = await Promise.all([getVersion(), getTauriVersion()]);
    return {
      name: 'tauri',
      version: `app ${app}, Tauri ${tauri}`,
      report: (data) => invoke('report', { json: JSON.stringify(data, null, 2) }),
      quit: () => invoke('quit'),
    };
  }
  const electron = window.herplanElectron;
  if (electron) {
    return {
      name: 'electron',
      version: `Electron ${electron.versions.electron}, Chromium ${electron.versions.chrome}`,
      report: (data) => electron.report(JSON.stringify(data, null, 2)),
      quit: () => electron.quit(),
    };
  }
  return {
    name: 'browser',
    version: navigator.userAgent,
    report: async (data) => {
      (window as unknown as { __HERPLAN_REPORT__: unknown }).__HERPLAN_REPORT__ = data;
    },
    quit: async () => {},
  };
}
