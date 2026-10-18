import { describe, expect, it } from 'vitest';
import { baseName, folderNameFor, normalizeProjectPath } from './paths';

describe('project paths', () => {
  it.each([
    ['project.json', 'project.json'],
    ['data/entities/abc.json', 'data/entities/abc.json'],
    ['documents\\Лор\\Мир.md', 'documents/Лор/Мир.md'],
    ['.herplan/workspace.json', '.herplan/workspace.json'],
    ['assets/cover.png', 'assets/cover.png'],
  ])('accepts %s', (input, expected) => {
    expect(normalizeProjectPath(input)).toBe(expected);
  });

  it.each([
    '',
    'data',
    '/data/a.json',
    'C:/data/a.json',
    'data/../project.json',
    'data/./a.json',
    'data//a.json',
    'backups/auto/x.zip',
    'other/a.json',
    'documents/con.md',
    'documents/a?.md',
    'documents/trailing.',
    'documents/space ',
    'data/project.json/..',
  ])('rejects %j', (input) => {
    expect(normalizeProjectPath(input)).toBeNull();
  });

  it('makes Windows-safe folder names', () => {
    expect(folderNameFor('Глава 1: Мельница?')).toBe('Глава 1 Мельница');
    expect(folderNameFor('  a/b\\c  ')).toBe('a b c');
    expect(folderNameFor('Проект...')).toBe('Проект');
    expect(folderNameFor('CON')).toBe('CON_');
  });

  it('takes the last path segment', () => {
    expect(baseName('C:\\Users\\me\\Мельница')).toBe('Мельница');
    expect(baseName('/Documents/HErPlan/Мир/')).toBe('Мир');
  });
});
