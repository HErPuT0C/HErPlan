import { describe, expect, it } from 'vitest';
import { listEntities } from '../story/entities';
import { tutorialProject } from '../tutorial/project';
import { entitySearchText, findMentions, mentionIndex, mentionTargets, type MentionTarget } from './mentions';

const { data } = tutorialProject('ru', '0.7.3', new Date('2026-10-26T10:00:00Z'));
const index = mentionIndex(mentionTargets(data));
const names = (text: string, self?: MentionTarget) =>
  findMentions(text, index, self).map((m) => `${m.target.kind}:${text.slice(m.start, m.end)}`);

describe('names of cards and tags in descriptions (0.7.3)', () => {
  it('finds cards and tags as whole words, whatever the case and "ё"', () => {
    expect(names('Ника и ян пришли к Веле. СМЕЛАЯ, но не хитрая.')).toEqual([
      'entity:Ника',
      'entity:ян',
      'tag:СМЕЛАЯ',
      'tag:хитрая',
    ]);
    // Inside another word a name is not a name.
    expect(names('Никак, Яна, Вела-торговка')).toEqual(['entity:Вела']);
  });

  it('takes the longest name that starts at a place and does not link a text to its own card', () => {
    const many = mentionIndex([
      { kind: 'entity', id: 'a', name: 'Ян' },
      { kind: 'entity', id: 'b', name: 'Ян Старший' },
    ]);
    const text = 'Ян Старший и Ян';
    expect(findMentions(text, many).map((m) => [m.target.id, text.slice(m.start, m.end)])).toEqual([
      ['b', 'Ян Старший'],
      ['a', 'Ян'],
    ]);
    expect(names('Ника — это я', { kind: 'entity', id: 'tut-nika', name: 'Ника' })).toEqual([]);
  });

  it('keeps offsets right in a text with letters whose lower case is longer', () => {
    const text = 'İ Ника';
    const [m] = findMentions(text, index);
    expect(text.slice(m.start, m.end)).toBe('Ника');
  });

  it('a card is found by its description, field values, tags and relations', () => {
    const nika = listEntities(data).find((e) => e.id === 'tut-nika')!;
    const text = entitySearchText(data, nika);
    expect(text).toContain('Ученица смотрителя');
    expect(text).toContain('Смелая');
    expect(text).toContain('15');
  });
});
