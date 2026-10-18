import { describe, expect, it } from 'vitest';
import { isId, newId } from './ids';

describe('newId', () => {
  it('produces valid, unique identifiers', () => {
    const ids = new Set(Array.from({ length: 10_000 }, newId));
    expect(ids.size).toBe(10_000);
    for (const id of ids) expect(isId(id)).toBe(true);
  });
});
