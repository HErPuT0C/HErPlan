// Renders the application icons from the brand SVGs (docs/brand) with Chromium.
// Usage (from app/): node scripts/render-icons.mjs
// Small sizes use a simplified drawing so the mark stays readable in the taskbar.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const brand = new URL('../../docs/brand/', import.meta.url);
const icons = new URL('../src-tauri/icons/', import.meta.url);
const full = readFileSync(new URL('icon.svg', brand), 'utf8');
const small = readFileSync(new URL('icon-small.svg', brand), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();

/** Rasterizes an SVG at the given size; returns the PNG and the raw RGBA pixels. */
async function render(size) {
  const svg = size <= 32 ? small : full;
  const { png, rgba } = await page.evaluate(
    async ({ svg, size }) => {
      const img = new Image(size, size);
      img.src = 'data:image/svg+xml;base64,' + btoa(svg);
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      return {
        png: canvas.toDataURL('image/png').split(',')[1],
        rgba: Array.from(ctx.getImageData(0, 0, size, size).data),
      };
    },
    { svg, size },
  );
  return { size, png: Buffer.from(png, 'base64'), rgba };
}

// Windows icon entry as a 32-bit DIB: header, bottom-up BGRA rows, then an all-zero AND mask.
function dib({ size, rgba }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = (y * size + x) * 4;
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
      pixels[dst + 3] = rgba[src + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

// ICO like the Tauri CLI writes it: DIB entries below 256 px, a PNG entry for 256 px.
function ico(images) {
  const payloads = images.map((image) => (image.size >= 256 ? image.png : dib(image)));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(payloads[i].length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += payloads[i].length;
  });
  return Buffer.concat([header, ...payloads]);
}

const rendered = new Map();
for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256, 512]) rendered.set(size, await render(size));
await browser.close();

writeFileSync(new URL('32x32.png', icons), rendered.get(32).png);
writeFileSync(new URL('128x128.png', icons), rendered.get(128).png);
writeFileSync(new URL('128x128@2x.png', icons), rendered.get(256).png);
writeFileSync(new URL('icon.png', icons), rendered.get(512).png);
writeFileSync(new URL('icon.ico', icons), ico([16, 20, 24, 32, 40, 48, 64, 256].map((s) => rendered.get(s))));
console.log('icons written to', icons.pathname);
