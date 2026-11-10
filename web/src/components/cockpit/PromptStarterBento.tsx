import type { PromptChipProps } from './PromptChip';
import { PromptChip } from './PromptChip';

const chips: Omit<PromptChipProps, 'onClick'>[] = [
  {
    title: 'Audit Vector Recall Latency across Hybrid Storage',
    caption: 'Measure hybrid retrieval timing and identify the slowest subsystem.',
  },
  {
    title: 'Verify Hallucination Guardrail Enforcement on Refusals',
    caption: 'Check that guardrails block policy-violating completions.',
  },
  {
    title: 'Trace Knowledge Graph Lineage for Extracted Entities',
    caption: 'Follow how entities link into and out of the graph.',
  },
  {
    title: 'Compare Dense vs BM25 Precision over Current Files',
    caption: 'Split hybrid precision by dense and lexical contributors.',
  },
];

export const PromptStarterBento: React.FC<{ onChipFill: (text: string) => void }> = ({ onChipFill }) => (
  <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
    {chips.map((chip, index) => (
      <PromptChip key={index} {...chip} onClick={onChipFill} />
    ))}
  </div>
);
