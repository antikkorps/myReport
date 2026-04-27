import { FormatRegistry } from '@sinclair/typebox';

// TypeBox refuses unknown `format` keywords at validation time. We
// register the JSON Schema formats we use so that `Value.Check()` and
// Fastify's Ajv pipeline agree. Each validator delegates to the
// pattern declared on the schema, so the regex remains the single
// source of truth.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

let registered = false;

export function registerFormats(): void {
  if (registered) return;
  if (!FormatRegistry.Has('email')) FormatRegistry.Set('email', (v) => EMAIL.test(v));
  if (!FormatRegistry.Has('uuid')) FormatRegistry.Set('uuid', (v) => UUID.test(v));
  if (!FormatRegistry.Has('date-time'))
    FormatRegistry.Set('date-time', (v) => ISO_DATETIME.test(v));
  registered = true;
}

registerFormats();
