// A drawing saved as a PNG that carries its source (0.9): the picture is an ordinary PNG — every program shows
// it, documents export it — and an iTXt chunk "herplan-drawing" inside holds the drawing's shapes as JSON, so
// HErPlan opens it for drawing again. The chunk travels with the file when it is renamed, moved or copied.
// Programs that rewrite the picture drop the chunk: the picture then opens as a plain one to draw on.

import { parseDrawing, type Drawing } from './model';

export const DRAWING_KEY = 'herplan-drawing';
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let table: Uint32Array | null = null;

/** CRC-32 of PNG chunks (the same as zlib's). */
export function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

interface Chunk {
  type: string;
  start: number;
  /** Where its data starts and how long it is. */
  data: number;
  length: number;
  end: number;
}

function chunks(bytes: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.length) break;
    out.push({ type, start: at, data: at + 8, length, end });
    at = end;
    if (type === 'IEND') break;
  }
  return out;
}

/** The size of a PNG from its header, or null. */
export function pngSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (!isPng(bytes)) return null;
  const head = chunks(bytes)[0];
  if (!head || head.type !== 'IHDR' || head.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { w: view.getUint32(head.data), h: view.getUint32(head.data + 4) };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** The PNG with the drawing's source in it (an older source in it is replaced). */
export function withDrawing(png: Uint8Array, drawing: Drawing): Uint8Array {
  if (!isPng(png)) throw new Error('not a PNG');
  const text = new TextEncoder().encode(JSON.stringify(drawing));
  const key = new TextEncoder().encode(DRAWING_KEY);
  // keyword, NUL, not compressed, method 0, no language, NUL, no translated keyword, NUL, the text.
  const data = new Uint8Array(key.length + 5 + text.length);
  data.set(key, 0);
  data.set(text, key.length + 5);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (const c of chunks(png)) {
    if (c.type === 'iTXt' && isOurs(png, c)) continue;
    if (c.type === 'IEND') parts.push(chunk('iTXt', data));
    parts.push(png.subarray(c.start, c.end));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function isOurs(bytes: Uint8Array, c: Chunk): boolean {
  const key = DRAWING_KEY;
  if (c.length < key.length + 1) return false;
  for (let i = 0; i < key.length; i++) if (bytes[c.data + i] !== key.charCodeAt(i)) return false;
  return bytes[c.data + key.length] === 0;
}

/** The drawing a PNG carries, or null (not a PNG, no source, or a source this version cannot read). */
export function drawingOf(bytes: Uint8Array): Drawing | null {
  if (!isPng(bytes)) return null;
  for (const c of chunks(bytes)) {
    if (c.type !== 'iTXt' || !isOurs(bytes, c)) continue;
    let at = c.data + DRAWING_KEY.length + 1;
    const compressed = bytes[at];
    if (compressed !== 0) return null;
    at += 2;
    // Language tag and translated keyword, each ended by NUL.
    for (let nul = 0; nul < 2 && at < c.data + c.length; at++) if (bytes[at] === 0) nul++;
    try {
      return parseDrawing(JSON.parse(new TextDecoder().decode(bytes.subarray(at, c.data + c.length))));
    } catch {
      return null;
    }
  }
  return null;
}
