import matter from 'gray-matter';

export type SchemaFieldType = 'string' | 'date' | 'number' | 'boolean' | 'array';

export interface CollectionSchemaField {
  name: string;
  type: SchemaFieldType;
  required: boolean;
  default?: string | number | boolean | null;
}

export function inferCollectionSchema(contents: string[]): CollectionSchemaField[] {
  const fields = new Map<string, { type: SchemaFieldType; observed: number }>();

  for (const content of contents) {
    // `{}` disables gray-matter's same-content cache (see editor-rules.ts's
    // parseMarkdownDocument for the full explanation) — without it, two
    // files in `contents` with byte-identical text (e.g. both freshly
    // scaffolded from the same template) would have the second one's
    // `.data` come back stale, undercounting that file's fields.
    const data = matter(content, {}).data;
    for (const [name, value] of Object.entries(data)) {
      const nextType = inferFieldType(value);
      if (!nextType) continue;
      const existing = fields.get(name);
      fields.set(name, {
        type: existing ? mergeFieldTypes(existing.type, nextType) : nextType,
        observed: (existing?.observed ?? 0) + 1,
      });
    }
  }

  return [...fields.entries()]
    .map(([name, field]) => ({
      name,
      type: field.type,
      required: field.observed === contents.length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseSchemaJson(value: string): CollectionSchemaField[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Schema must be an array.');
  return parsed.map((field) => normalizeSchemaField(field));
}

export function serializeSchemaFields(fields: CollectionSchemaField[]) {
  return JSON.stringify(fields.map((field) => normalizeSchemaField(field)));
}

export function schemaFieldsFromForm(formData: FormData): CollectionSchemaField[] {
  const names = formData.getAll('fieldName');
  const types = formData.getAll('fieldType');
  const required = new Set(formData.getAll('fieldRequired').filter((value) => typeof value === 'string'));

  return names.flatMap((value, index): CollectionSchemaField[] => {
    if (typeof value !== 'string') return [];
    const name = value.trim();
    if (!name) return [];
    const typeValue = types[index];
    const type = typeof typeValue === 'string' && isSchemaFieldType(typeValue) ? typeValue : 'string';
    return [{ name, type, required: required.has(String(index)) }];
  });
}

function normalizeSchemaField(value: unknown): CollectionSchemaField {
  if (!value || typeof value !== 'object') throw new Error('Schema field must be an object.');
  const candidate = value as Partial<CollectionSchemaField>;
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
    throw new Error('Schema field name is required.');
  }
  if (!isSchemaFieldType(candidate.type)) {
    throw new Error(`Schema field "${candidate.name}" has an invalid type.`);
  }
  return {
    name: candidate.name.trim(),
    type: candidate.type,
    required: Boolean(candidate.required),
    ...(candidate.default === undefined ? {} : { default: candidate.default }),
  };
}

function inferFieldType(value: unknown): SchemaFieldType | null {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'date';
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(value) ? 'date' : 'string';
  }
  return null;
}

function mergeFieldTypes(current: SchemaFieldType, next: SchemaFieldType): SchemaFieldType {
  if (current === next) return current;
  if (current === 'string' || next === 'string') return 'string';
  if (current === 'array' || next === 'array') return 'array';
  return 'string';
}

function isSchemaFieldType(value: unknown): value is SchemaFieldType {
  return (
    value === 'string' ||
    value === 'date' ||
    value === 'number' ||
    value === 'boolean' ||
    value === 'array'
  );
}
