import Ajv2020 from 'ajv/dist/2020';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import schema from '../../../docs/format/export-v1.schema.json';
import { exportStory } from './export';
import { findNode } from './model';
import { sampleProject } from './sample';
import { addCatalog, addField, addTag, newField } from '../world/schema';

// The published schema (docs/format/export-v1.schema.json) must accept what HErPlan actually writes.
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

describe('export schema v1', () => {
  it('accepts the reference scenario', () => {
    const ok = validate(JSON.parse(JSON.stringify(exportStory(sampleProject(), '0.2.0'))));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  it('accepts broken expressions as source with an empty tree', () => {
    const data = produce(sampleProject(), (d) => {
      findNode(d, { graph: 'g-ch1', node: 'a-check' })!.expr = 'доверие <';
      findNode(d, { graph: 'g-ch1', node: 'a-reward' })!.effects = 'золото +=';
    });
    expect(validate(JSON.parse(JSON.stringify(exportStory(data, '0.2.0'))))).toBe(true);
  });

  it('accepts a node that is both a payoff and a consequence (0.3.1)', () => {
    const data = produce(sampleProject(), (d) => {
      findNode(d, { graph: 'g-ch1', node: 'a-check' })!.plotRoles = ['payoff', 'consequence'];
    });
    expect(validate(JSON.parse(JSON.stringify(exportStory(data, '0.3.1'))))).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it('accepts catalogs of tags and a tags field (0.4)', () => {
    const data = produce(sampleProject(), (d) => {
      const catalog = addCatalog(d, 'Черты');
      const tag = addTag(d, catalog, 'ловкий', 'уклоняется')!;
      const field = { ...newField('tags', 'Черты'), catalog };
      addField(d, { kind: 'type', id: 'character' }, field);
      d.entities['ent-mira'].values = { [field.id]: [tag] };
    });
    validate(JSON.parse(JSON.stringify(exportStory(data, '0.4.0'))));
    expect(validate.errors ?? []).toEqual([]);
  });

  it('rejects a file of another format', () => {
    expect(validate({ format: 'something-else', version: 1 })).toBe(false);
  });
});
