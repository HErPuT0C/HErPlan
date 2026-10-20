import { describe, expect, it } from 'vitest';
import { MemoryPlatform } from './memory';
import type { Platform, PlatformError } from './types';

const DIR = '/Documents/HErPlan/Мельница';

async function project(): Promise<Platform> {
  const platform = new MemoryPlatform(false);
  await platform.createProject(DIR, [{ path: 'project.json', text: '{}' }]);
  return platform;
}

/** The error code a call fails with, or "ok". */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return 'ok';
  } catch (e) {
    return (e as PlatformError).code;
  }
}

async function listing(platform: Platform): Promise<string[]> {
  return (await platform.listAssets(DIR)).map((e) => `${e.kind === 'folder' ? 'd' : 'f'} ${e.path}`);
}

describe('memory platform: asset library', () => {
  it('writes bytes as new files with numbered names on a clash', async () => {
    const platform = await project();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    expect(await platform.writeAsset(DIR, 'assets', 'Вставка.png', png)).toBe('assets/Вставка.png');
    expect(await platform.writeAsset(DIR, 'assets', 'Вставка.png', png)).toBe('assets/Вставка (2).png');
    expect(await platform.writeAsset(DIR, 'assets/Мир/Новая', 'a', png)).toBe('assets/Мир/Новая/a');

    const entries = await platform.listAssets(DIR);
    expect(entries.map((e) => [e.path, e.kind, e.size])).toEqual([
      ['assets/Вставка (2).png', 'file', 6],
      ['assets/Вставка.png', 'file', 6],
      ['assets/Мир', 'folder', 0],
      ['assets/Мир/Новая', 'folder', 0],
      ['assets/Мир/Новая/a', 'file', 6],
    ]);
    const url = await platform.assetUrl(DIR, 'assets/Вставка.png');
    expect(url).toBe('data:image/png;base64,iVBORwD/');

    for (const name of ['', 'a/b.png', 'a\\b.png', '..', 'con.png', 'a?.png', 'a.', '.a.png.tmp-1']) {
      expect(await codeOf(platform.writeAsset(DIR, 'assets', name, png)), name).toBe('invalid-path');
    }
  });

  it('makes, moves and deletes files and folders', async () => {
    const platform = await project();
    const bytes = new Uint8Array([1, 2, 3]);
    await platform.writeAsset(DIR, 'assets/Мир', 'a.png', bytes);
    await platform.assetMkdir(DIR, 'assets/Пусто/Глубже');
    await platform.assetMkdir(DIR, 'assets/Пусто');
    expect(await listing(platform)).toEqual([
      'd assets/Мир',
      'f assets/Мир/a.png',
      'd assets/Пусто',
      'd assets/Пусто/Глубже',
    ]);

    await platform.assetMove(DIR, 'assets/Мир/a.png', 'assets/Новая/b.png');
    await platform.assetMove(DIR, 'assets/Новая/b.png', 'assets/Новая/B.png');
    await platform.assetMove(DIR, 'assets/Новая', 'assets/Пусто/Новая');
    // Emptied folders stay, as on disk.
    expect(await listing(platform)).toEqual([
      'd assets/Мир',
      'd assets/Пусто',
      'd assets/Пусто/Глубже',
      'd assets/Пусто/Новая',
      'f assets/Пусто/Новая/B.png',
    ]);

    expect(await codeOf(platform.assetMove(DIR, 'assets/Пусто', 'assets/Пусто/Глубже/x'))).toBe('invalid-path');
    expect(await codeOf(platform.assetMove(DIR, 'assets/Мир', 'assets/Пусто'))).toBe('exists');
    expect(await codeOf(platform.assetMove(DIR, 'assets/none.png', 'assets/x.png'))).toBe('not-found');
    expect(await codeOf(platform.assetMkdir(DIR, 'assets/Пусто/Новая/B.png'))).toBe('exists');
    expect(await codeOf(platform.assetMkdir(DIR, 'assets/Пусто/Новая/B.png/sub'))).toBe('exists');

    await platform.assetDelete(DIR, 'assets/Пусто/Новая/B.png', false);
    await platform.assetDelete(DIR, 'assets/Пусто', false);
    await platform.assetDelete(DIR, 'assets/gone.png', false);
    expect(await listing(platform)).toEqual(['d assets/Мир']);
  });

  it('imports files and folders from outside, keeping the structure', async () => {
    const platform = await project();
    await platform.exportText('/Drop/cover.png', 'data:image/png;base64,AAAA');
    await platform.exportText('/Drop/Картинки/a.png', 'a');
    await platform.exportText('/Drop/Картинки/Персонажи/b.png', 'b');
    await platform.exportText('/Drop/Картинки/Thumbs.db', 'cache');
    await platform.exportText('/Drop/Картинки/Персонажи/desktop.ini', 'settings');
    const sources = ['/Drop/cover.png', '/Drop/Картинки'];

    expect(await platform.importAssets(DIR, sources, 'assets')).toEqual([
      'assets/cover.png',
      'assets/Картинки/a.png',
      'assets/Картинки/Персонажи/b.png',
    ]);
    expect(await platform.importAssets(DIR, sources, 'assets/Импорт')).toEqual([
      'assets/Импорт/cover.png',
      'assets/Импорт/Картинки/a.png',
      'assets/Импорт/Картинки/Персонажи/b.png',
    ]);
    expect(await platform.importAssets(DIR, sources, 'assets')).toEqual([
      'assets/cover (2).png',
      'assets/Картинки (2)/a.png',
      'assets/Картинки (2)/Персонажи/b.png',
    ]);
    const cover = (await platform.listAssets(DIR)).find((e) => e.path === 'assets/cover.png');
    expect(cover?.size).toBe(3);

    expect(await codeOf(platform.importAssets(DIR, ['/Drop/cover.png', '/Drop/none.png'], 'assets/new'))).toBe(
      'not-found',
    );
    expect((await platform.listAssets(DIR)).some((e) => e.path.startsWith('assets/new'))).toBe(false);
  });

  it('refuses paths outside assets', async () => {
    const platform = await project();
    await platform.writeAsset(DIR, 'assets', 'a.png', new Uint8Array([1]));
    const outside = ['assets', 'data/types.json', 'project.json', 'backups/auto', 'assets/../data', '../x', ''];
    for (const path of outside) {
      expect(await codeOf(platform.assetMkdir(DIR, path)), path).toBe('invalid-path');
      expect(await codeOf(platform.assetMove(DIR, 'assets/a.png', path)), path).toBe('invalid-path');
      expect(await codeOf(platform.assetMove(DIR, path, 'assets/b.png')), path).toBe('invalid-path');
      expect(await codeOf(platform.assetDelete(DIR, path, true)), path).toBe('invalid-path');
    }
    for (const dest of ['data', 'backups', 'assets/..', '']) {
      expect(await codeOf(platform.writeAsset(DIR, dest, 'b.png', new Uint8Array([1]))), dest).toBe('invalid-path');
      expect(await codeOf(platform.importAssets(DIR, [], dest)), dest).toBe('invalid-path');
    }
    expect(await listing(platform)).toEqual(['f assets/a.png']);
  });

  it('opens nothing and hears no native drops in a browser', async () => {
    const platform = await project();
    await expect(platform.openAsset(DIR, 'assets/a.png')).resolves.toBeUndefined();
    const stop = platform.onFileDrop(() => {
      throw new Error('a browser has no native file drops');
    });
    expect(() => stop()).not.toThrow();
  });
});
