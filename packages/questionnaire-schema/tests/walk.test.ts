import { describe, expect, it } from 'vitest';
import { type AnyNode, type QuestionnaireSchema, walkQuestionnaire } from '../src/index.ts';
import { uuid } from './helpers.ts';

describe('walkQuestionnaire', () => {
  it('visits sections, leaves and repeater children with their full path', () => {
    const schema: QuestionnaireSchema = {
      version: 1,
      title: 'T',
      sections: [
        {
          kind: 'section',
          id: uuid(),
          label: 'A',
          questions: [
            { kind: 'boolean', id: uuid(), label: 'b' },
            {
              kind: 'repeater',
              id: uuid(),
              label: 'r',
              questions: [
                { kind: 'text', id: uuid(), label: 't1' },
                { kind: 'number', id: uuid(), label: 'n1' },
              ],
            },
          ],
        },
        {
          kind: 'section',
          id: uuid(),
          label: 'B',
          questions: [{ kind: 'date', id: uuid(), label: 'd' }],
        },
      ],
    };

    const visited: { kind: AnyNode['kind']; path: string }[] = [];
    walkQuestionnaire(schema, (node, path) => visited.push({ kind: node.kind, path }));

    expect(visited).toEqual([
      { kind: 'section', path: 'sections[0]' },
      { kind: 'boolean', path: 'sections[0].questions[0]' },
      { kind: 'repeater', path: 'sections[0].questions[1]' },
      { kind: 'text', path: 'sections[0].questions[1].questions[0]' },
      { kind: 'number', path: 'sections[0].questions[1].questions[1]' },
      { kind: 'section', path: 'sections[1]' },
      { kind: 'date', path: 'sections[1].questions[0]' },
    ]);
  });
});
