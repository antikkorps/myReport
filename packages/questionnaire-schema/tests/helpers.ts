import type { ValidationResult } from '../src/index.ts';

export function uuid(): string {
  return crypto.randomUUID();
}

export const FIXED_ID = '00000000-0000-0000-0000-000000000001';

export function expectOk(result: ValidationResult): void {
  if (!result.ok) {
    throw new Error(`expected ok, got issues: ${JSON.stringify(result.issues, null, 2)}`);
  }
}

export function expectIssue(result: ValidationResult, code: string, pathHint?: string): void {
  if (result.ok) {
    throw new Error(`expected validation issues (${code}), got ok`);
  }
  const match = result.issues.find(
    (i) => i.code === code && (pathHint === undefined || i.path.includes(pathHint)),
  );
  if (!match) {
    throw new Error(
      `expected issue with code ${code}${pathHint ? ` (path includes ${pathHint})` : ''}, got: ${JSON.stringify(result.issues, null, 2)}`,
    );
  }
}

export function singleSection(questions: unknown[]): unknown {
  return {
    version: 1,
    title: 'T',
    sections: [
      {
        kind: 'section',
        id: uuid(),
        label: 'S',
        questions,
      },
    ],
  };
}
