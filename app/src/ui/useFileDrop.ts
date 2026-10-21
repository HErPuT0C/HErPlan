// Files dropped on an element: from the file explorer in the desktop build (absolute paths, through the
// platform), or as HTML5 drops in the web build (file contents). `over` says files hover the element.

import { useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';
import { platform } from '../platform';

export interface FileDropHandlers {
  /** Desktop: paths of the dropped files and folders, and where they were dropped (CSS pixels). */
  onPaths: (paths: string[], point: { x: number; y: number }) => void;
  /** Web build: the dropped files (folders are not available there). */
  onFiles: (files: File[], point: { x: number; y: number }) => void;
  disabled?: boolean;
}

const inside = (el: Element | null, x: number, y: number) => {
  const r = el?.getBoundingClientRect();
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};

export function useFileDrop(ref: RefObject<HTMLElement | null>, handlers: FileDropHandlers) {
  const [over, setOver] = useState(false);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const p = platform();
    const stopDrop = p.onFileDrop((paths, x, y) => {
      setOver(false);
      if (!latest.current.disabled && inside(ref.current, x, y)) latest.current.onPaths(paths, { x, y });
    });
    const stopOver = p.onFileDragOver?.((point) => setOver(!!point && inside(ref.current, point.x, point.y)));
    return () => {
      stopDrop();
      stopOver?.();
    };
  }, [ref]);

  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  return {
    over,
    /** Spread on the element for the web build's HTML5 drops. */
    dropProps: {
      onDragOver: (e: DragEvent) => {
        if (!hasFiles(e) || handlers.disabled) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        if (!handlers.disabled) handlers.onFiles([...e.dataTransfer.files], { x: e.clientX, y: e.clientY });
      },
    },
  };
}

/** A safe file name for bytes that came without one (a pasted screenshot). */
export function pastedName(file: File, fallback: string): string {
  const ext =
    file.type
      .split('/')[1]
      ?.replace('jpeg', 'jpg')
      .replace(/[^a-z0-9]/g, '') || 'png';
  const name = file.name && file.name !== 'image.png' ? file.name : `${fallback}.${ext}`;
  return name.replace(/[\\/:*?"<>|]/g, '_');
}
