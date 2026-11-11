import React from 'react';

export const EditorialMasthead: React.FC = () => (
  <section className="mx-auto max-w-[1200px] px-6 py-10 md:py-16">
    <div className="border-b border-hairline pt-4 pb-6">
      <h1 className="text-display text-ink tracking-[-0.035em]">Meridian LLMOps Cockpit</h1>
      <p className="mt-4 text-body text-muted leading-[1.65] max-w-60ch">
      Dual-memory RAG: dense vector search (Qdrant) + exact lexical search (BM25)
      + Reciprocal Rank Fusion, knowledge-graph entities, and verifiable citation
      provenance.
    </p>
    <div className="mt-4 border-t border-hairline" />
  </div>
  </section>
);
