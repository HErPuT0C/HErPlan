// Path rules shared by the interface and the in-memory platform. The Rust backend enforces the same rules.

const ROOTS = new Set(['data', 'documents', 'assets', '.herplan']);
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"|?*\u0000-\u001f]/;

/** Normalizes a path inside a project to forward slashes, or returns null if it is not allowed. */
export function normalizeProjectPath(path: string): string | null {
  const segments = path.replace(/\\/g, '/').split('/');
  if (segments.length === 1 && segments[0] === 'project.json') return 'project.json';
  if (segments.length < 2 || !ROOTS.has(segments[0])) return null;
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return null;
    if (INVALID_CHARS.test(segment) || RESERVED.test(segment) || /[. ]$/.test(segment)) return null;
  }
  return segments.join('/');
}

/**
 * Turns a project name into a folder name Windows accepts: invalid characters become spaces,
 * trailing dots and spaces are trimmed, reserved device names get an underscore.
 */
export function folderNameFor(name: string): string {
  let folder = name
    .replace(/[<>:"/\\|?*]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (RESERVED.test(folder)) folder = `${folder}_`;
  return folder.slice(0, 120);
}

/** Last segment of an absolute path, for either separator. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
