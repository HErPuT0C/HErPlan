// Picks the platform once at startup: the Rust backend inside the desktop application,
// the in-memory one in a plain browser (dev server, end-to-end tests).

import { MemoryPlatform } from './memory';
import { TauriPlatform } from './tauri';
import type { Platform } from './types';

export * from './types';

let instance: Platform | null = null;

export function platform(): Platform {
  instance ??= '__TAURI_INTERNALS__' in window ? new TauriPlatform() : new MemoryPlatform();
  return instance;
}

/** Tests replace the platform with their own instance. */
export function setPlatform(next: Platform): void {
  instance = next;
}
