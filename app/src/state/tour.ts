// The tour of the application (0.7, F7-10): a few steps over the open project that show its parts. It opens by
// itself on the first start (with the tutorial project) and again from the settings.

import { atom } from '../core/atom';
import { updateSettings } from './settings';

/** The step on screen, or null when the tour is not running. */
export const tour = atom<{ step: number } | null>(null);

export function startTour(): void {
  // Seen from now on, even if the window is closed in the middle of it.
  updateSettings((s) => ({ ...s, tourSeen: true }));
  tour.set({ step: 0 });
}

export function tourStep(step: number): void {
  tour.set({ step });
}

export function endTour(): void {
  tour.set(null);
}
