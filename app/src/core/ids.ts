// Stable object identifiers. IDs never depend on names or paths, so renames and moves keep every reference valid.

export type ObjectKind =
  'entity' | 'type' | 'graph' | 'node' | 'edge' | 'document' | 'board' | 'task' | 'asset' | 'variable';

export interface ObjectRef {
  kind: ObjectKind;
  id: string;
}

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase: no i, l, o, u.

/** 16 characters of base32 = 80 random bits: collisions are not a practical concern for a single project. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

export function isId(value: string): boolean {
  return /^[0-9a-hjkmnp-tv-z]{16}$/.test(value);
}
