import { Value } from '@sinclair/typebox/value';
import type { AnyNode, LeafQuestion, RepeaterQuestion } from './questions.ts';
import { type QuestionnaireSchema, TQuestionnaireSchema } from './schema.ts';
import { walkQuestionnaire } from './walk.ts';

export type ValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; schema: QuestionnaireSchema }
  | { ok: false; issues: ValidationIssue[] };

export function validateQuestionnaireSchema(input: unknown): ValidationResult {
  if (!Value.Check(TQuestionnaireSchema, input)) {
    const issues: ValidationIssue[] = [];
    for (const e of Value.Errors(TQuestionnaireSchema, input)) {
      issues.push({
        path: pointerToPath(e.path),
        code: 'SHAPE',
        message: e.message,
      });
    }
    return { ok: false, issues };
  }

  const schema = input as QuestionnaireSchema;
  const issues: ValidationIssue[] = [];

  // Globally unique IDs across sections, leaves and repeater children.
  const seen = new Map<string, string>();
  walkQuestionnaire(schema, (node, path) => {
    const prev = seen.get(node.id);
    if (prev !== undefined) {
      issues.push({
        path,
        code: 'DUPLICATE_ID',
        message: `id "${node.id}" already declared at ${prev}`,
      });
    } else {
      seen.set(node.id, path);
    }
  });

  walkQuestionnaire(schema, (node, path) => {
    issues.push(...nodeRules(node, path));
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, schema };
}

function nodeRules(node: AnyNode, path: string): ValidationIssue[] {
  if (node.kind === 'section') return [];
  return leafOrRepeaterRules(node, path);
}

function leafOrRepeaterRules(
  node: LeafQuestion | RepeaterQuestion,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  switch (node.kind) {
    case 'text': {
      pushTextLengthRange(node, path, issues);
      if (node.pattern !== undefined) {
        try {
          new RegExp(node.pattern);
        } catch (err) {
          issues.push({
            path: `${path}.pattern`,
            code: 'INVALID_PATTERN',
            message: `invalid regex: ${(err as Error).message}`,
          });
        }
      }
      break;
    }
    case 'longText': {
      pushTextLengthRange(node, path, issues);
      break;
    }
    case 'number': {
      if (node.min !== undefined && node.max !== undefined && node.min > node.max) {
        issues.push({
          path,
          code: 'INVALID_RANGE',
          message: `min (${node.min}) cannot exceed max (${node.max})`,
        });
      }
      if (node.integer === true) {
        if (node.min !== undefined && !Number.isInteger(node.min)) {
          issues.push({
            path: `${path}.min`,
            code: 'INVALID_INTEGER_BOUND',
            message: 'min must be an integer when integer:true',
          });
        }
        if (node.max !== undefined && !Number.isInteger(node.max)) {
          issues.push({
            path: `${path}.max`,
            code: 'INVALID_INTEGER_BOUND',
            message: 'max must be an integer when integer:true',
          });
        }
      }
      break;
    }
    case 'singleChoice':
    case 'multiChoice': {
      const seenValues = new Set<string>();
      node.options.forEach((opt, idx) => {
        if (seenValues.has(opt.value)) {
          issues.push({
            path: `${path}.options[${idx}]`,
            code: 'DUPLICATE_OPTION_VALUE',
            message: `option value "${opt.value}" already used`,
          });
        }
        seenValues.add(opt.value);
      });
      if (node.kind === 'multiChoice') {
        if (
          node.minSelected !== undefined &&
          node.maxSelected !== undefined &&
          node.minSelected > node.maxSelected
        ) {
          issues.push({
            path,
            code: 'INVALID_RANGE',
            message: `minSelected (${node.minSelected}) cannot exceed maxSelected (${node.maxSelected})`,
          });
        }
        if (node.maxSelected !== undefined && node.maxSelected > node.options.length) {
          issues.push({
            path: `${path}.maxSelected`,
            code: 'INVALID_RANGE',
            message: `maxSelected (${node.maxSelected}) cannot exceed number of options (${node.options.length})`,
          });
        }
      }
      break;
    }
    case 'scale': {
      if (node.min >= node.max) {
        issues.push({
          path,
          code: 'INVALID_RANGE',
          message: `scale min (${node.min}) must be strictly less than max (${node.max})`,
        });
      }
      break;
    }
    case 'date': {
      const minOk = node.min === undefined || isValidIsoDate(node.min);
      const maxOk = node.max === undefined || isValidIsoDate(node.max);
      if (node.min !== undefined && !minOk) {
        issues.push({
          path: `${path}.min`,
          code: 'INVALID_DATE',
          message: `min "${node.min}" is not a valid calendar date`,
        });
      }
      if (node.max !== undefined && !maxOk) {
        issues.push({
          path: `${path}.max`,
          code: 'INVALID_DATE',
          message: `max "${node.max}" is not a valid calendar date`,
        });
      }
      if (
        node.min !== undefined &&
        node.max !== undefined &&
        minOk &&
        maxOk &&
        node.min > node.max
      ) {
        issues.push({
          path,
          code: 'INVALID_RANGE',
          message: `date min (${node.min}) cannot exceed max (${node.max})`,
        });
      }
      break;
    }
    case 'attachment': {
      if (node.mimeTypes !== undefined) {
        node.mimeTypes.forEach((mt, idx) => {
          if (!MIME_TYPE_RE.test(mt)) {
            issues.push({
              path: `${path}.mimeTypes[${idx}]`,
              code: 'INVALID_MIME',
              message: `"${mt}" is not a valid MIME type`,
            });
          }
        });
      }
      break;
    }
    case 'repeater': {
      if (
        node.minItems !== undefined &&
        node.maxItems !== undefined &&
        node.minItems > node.maxItems
      ) {
        issues.push({
          path,
          code: 'INVALID_RANGE',
          message: `minItems (${node.minItems}) cannot exceed maxItems (${node.maxItems})`,
        });
      }
      break;
    }
    case 'boolean':
      break;
  }
  return issues;
}

const MIME_TYPE_RE = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+\-*]+$/;

function pushTextLengthRange(
  node: { minLength?: number; maxLength?: number },
  path: string,
  issues: ValidationIssue[],
): void {
  if (
    node.minLength !== undefined &&
    node.maxLength !== undefined &&
    node.minLength > node.maxLength
  ) {
    issues.push({
      path,
      code: 'INVALID_RANGE',
      message: `minLength (${node.minLength}) cannot exceed maxLength (${node.maxLength})`,
    });
  }
}

function pointerToPath(pointer: string): string {
  if (pointer === '') return '';
  const segments = pointer.split('/').slice(1);
  let out = '';
  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i] ?? '';
    const decoded = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (/^\d+$/.test(decoded)) {
      out += `[${decoded}]`;
    } else {
      out += i === 0 ? decoded : `.${decoded}`;
    }
  }
  return out;
}

function isValidIsoDate(input: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
