export const PREVIEW_QUESTION = 'How do passages from two documents combine into a grounded answer?';

export const PREVIEW_ANSWER =
  'Retrieval finds relevant passages in the indexed documents. The research paper describes selecting external evidence; the chunking notes explain how source text becomes searchable passages. Meridian places those passages in the model context so the response can be traced back to both files.';

export const PREVIEW_SOURCES = [
  {
    id: 'rag-survey',
    file: 'rag-survey-2024.pdf',
    title: 'Retrieval-augmented generation survey',
    type: 'Research paper · PDF',
    chunks: 51,
    locator: 'p. 8 · § 3.2',
    excerpt: 'The retriever selects relevant passages from external memory before the generator composes an answer.',
  },
  {
    id: 'chunking-notes',
    file: 'meridian-chunking-notes.md',
    title: 'Meridian chunking notes',
    type: 'Technical note · Markdown',
    chunks: 12,
    locator: '§ Passage sizing',
    excerpt: 'Each source is divided into passages that can be indexed and retrieved independently.',
  },
  {
    id: 'vector-notes',
    file: 'vector-search-notes.pdf',
    title: 'Vector search notes',
    type: 'Technical note · PDF',
    chunks: 8,
    locator: 'p. 3 · § 1.4',
    excerpt: 'Retrieved passages are assembled as contextual evidence before the language model responds.',
  },
] as const;

export const PREVIEW_EVIDENCE = [
  { id: 1, sourceId: 'rag-survey', claim: 'Retriever selects evidence' },
  { id: 2, sourceId: 'chunking-notes', claim: 'Source text becomes passages' },
  { id: 3, sourceId: 'vector-notes', claim: 'Passages ground the response' },
] as const;

export function formatProvider(provider: string): string {
  const labels: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    groq: 'Groq',
    openrouter: 'OpenRouter',
    deepseek: 'DeepSeek',
    ollama: 'Ollama',
    custom: 'Custom endpoint',
  };
  return labels[provider] ?? provider;
}

export function formatDuration(milliseconds: number | null | undefined): string {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return '—';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}
