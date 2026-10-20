// Values of entity fields (F4-02): what each kind of field holds, read tolerantly from files edited by
// hand, shown as text (table view, search) and compared (sorting).

import type { FieldDef } from './schema';

/** A table field: rows of cells, one per column of the field. */
export interface TableValue {
  rows: string[][];
}

export type FieldValue = string | number | boolean | string[] | TableValue | null;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value as the field's kind holds it; anything that does not fit becomes the empty value. */
export function coerceValue(field: FieldDef, raw: unknown): FieldValue {
  switch (field.type) {
    case 'text':
    case 'richtext':
      return typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : '';
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    case 'percent':
      return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : null;
    case 'bool':
      return raw === true;
    case 'enum':
      return typeof raw === 'string' && (field.options ?? []).includes(raw) ? raw : null;
    case 'ref':
    case 'image':
      return typeof raw === 'string' && raw ? raw : null;
    case 'color':
      return typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null;
    case 'refList':
    case 'tags':
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x) : [];
    case 'table': {
      const columns = field.columns?.length ?? 0;
      const rows = isObject(raw) && Array.isArray(raw.rows) ? raw.rows : [];
      return {
        rows: rows
          .filter(Array.isArray)
          .map((r) => Array.from({ length: columns }, (_, i) => (typeof r[i] === 'string' ? r[i] : ''))),
      };
    }
  }
}

export function isEmptyValue(v: FieldValue): boolean {
  if (v === null || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return v.rows.length === 0;
  return false;
}

export interface ValueTextContext {
  entityName: (id: string) => string | null;
  /** The name of a catalog tag (Tags fields); unknown tags are left out. */
  tagName?: (id: string) => string | null;
  yes: string;
  no: string;
}

/** One line of text for a value: table cells, search, CSV-like display. */
export function valueText(field: FieldDef, v: FieldValue, ctx: ValueTextContext): string {
  if (v === null) return '';
  switch (field.type) {
    case 'bool':
      return v ? ctx.yes : ctx.no;
    case 'percent':
      return `${v as number} %`;
    case 'ref':
      return ctx.entityName(v as string) ?? '';
    case 'refList':
      return (v as string[])
        .map((id) => ctx.entityName(id))
        .filter(Boolean)
        .join(', ');
    case 'tags':
      return (v as string[])
        .map((id) => ctx.tagName?.(id) ?? null)
        .filter(Boolean)
        .join(', ');
    case 'image':
      return String(v).split('/').pop() ?? '';
    case 'table':
      return (v as TableValue).rows.map((r) => r.join(' · ')).join('; ');
    default:
      return String(v);
  }
}

/** Order of two values of a field: numbers as numbers, the rest as text; empty values go last. */
export function compareValues(field: FieldDef, a: FieldValue, b: FieldValue, ctx: ValueTextContext): number {
  const ea = isEmptyValue(a) && field.type !== 'bool';
  const eb = isEmptyValue(b) && field.type !== 'bool';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (field.type === 'number' || field.type === 'percent') return (a as number) - (b as number);
  if (field.type === 'bool') return Number(b === true) - Number(a === true);
  if (field.type === 'enum') {
    const options = field.options ?? [];
    return options.indexOf(a as string) - options.indexOf(b as string);
  }
  return valueText(field, a, ctx).localeCompare(valueText(field, b, ctx));
}
