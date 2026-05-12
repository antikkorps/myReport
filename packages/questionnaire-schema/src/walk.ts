import type { AnyNode, LeafQuestion, RepeaterQuestion } from './questions.ts';
import type { QuestionnaireSchema } from './schema.ts';

export type Visitor = (node: AnyNode, path: string) => void;

export function walkQuestionnaire(schema: QuestionnaireSchema, visit: Visitor): void {
  schema.sections.forEach((section, sIdx) => {
    const sPath = `sections[${sIdx}]`;
    visit(section, sPath);
    section.questions.forEach((q, qIdx) => {
      walkSectionContent(q, `${sPath}.questions[${qIdx}]`, visit);
    });
  });
}

function walkSectionContent(
  node: LeafQuestion | RepeaterQuestion,
  path: string,
  visit: Visitor,
): void {
  visit(node, path);
  if (node.kind === 'repeater') {
    node.questions.forEach((leaf, idx) => {
      visit(leaf, `${path}.questions[${idx}]`);
    });
  }
}
