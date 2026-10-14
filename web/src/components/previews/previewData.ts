export const PREVIEW_QUESTION = 'How do passages from two documents combine into a grounded answer?';

export const PREVIEW_ANSWER =
  'Retrieval finds relevant passages in the indexed documents. The research paper describes selecting external evidence; the chunking notes explain how source text becomes searchable passages. Meridian places those passages in the model context so the response can be traced back to both files.';

export const PREVIEW_CLAIMS = [
  'Retrieval finds relevant passages in the indexed documents.',
  'The research paper describes selecting external evidence; the chunking notes explain how source text becomes searchable passages.',
  'Meridian places those passages in the model context so the response can be traced back to both files.',
] as const;

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

export function requestsWithinRange<T extends { recorded_at: string }>(
  requests: T[],
  range: string,
): T[] {
  const durations: Record<string, number> = {
    '90 minutes': 90 * 60_000,
    '6 hours': 6 * 60 * 60_000,
    '24 hours': 24 * 60 * 60_000,
    '7 days': 7 * 24 * 60 * 60_000,
    '30 days': 30 * 24 * 60 * 60_000,
  };
  const cutoff = Date.now() - (durations[range] ?? durations['24 hours']);
  return requests.filter((request) => {
    const timestamp = Date.parse(request.recorded_at);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

export function requestsForEventList<T extends { recorded_at: string }>(
  requests: T[],
  range: string,
): T[] {
  const timed = requestsWithinRange(requests, range);
  const untimed = requests.filter((request) => !Number.isFinite(Date.parse(request.recorded_at)));
  return [...timed, ...untimed];
}

export function formatRequestTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp)
    : 'Time unavailable';
}

export function latencyPolyline(
  requests: Array<{ duration_ms: number }>,
  width = 630,
  height = 130,
): string {
  if (requests.length === 0) return '';
  const ordered = [...requests].reverse();
  const maximum = Math.max(...ordered.map((request) => request.duration_ms), 1000) * 1.1;
  return ordered.map((request, index) => {
    const x = ordered.length === 1 ? width / 2 : (index / (ordered.length - 1)) * width;
    const y = height - (request.duration_ms / maximum) * height;
    return `${x},${y}`;
  }).join(' ');
}

export function latencyTicks(requests: Array<{ duration_ms: number }>): [string, string, string, string] {
  const maximum = Math.max(...requests.map((request) => request.duration_ms), 1000) * 1.1;
  return [formatDuration(maximum), formatDuration(maximum * 2 / 3), formatDuration(maximum / 3), '0 ms'];
}

export function requestRangeNotice(
  requests: Array<{ recorded_at: string }>,
  range: string,
  error = '',
): string {
  if (error) return error;
  const untimed = requests.filter((request) => !Number.isFinite(Date.parse(request.recorded_at))).length;
  if (untimed) return `${untimed} recent ${untimed === 1 ? 'request lacks' : 'requests lack'} a timestamp, so it cannot be placed in the selected time range. Restart the API to record timestamps for new requests.`;
  return `No requests were recorded in this time range (${range}).`;
}

export function stageMilliseconds(
  timings: Record<string, number>,
  stage: 'retrieval' | 'generation',
): number {
  const isRetrieval = (name: string) => /embed_query|dense_search|bm25_search|fusion|rerank/.test(name);
  const isGeneration = (name: string) => /generation|generate|completion|llm/i.test(name) && !isRetrieval(name);
  return Object.entries(timings).reduce((total, [name, duration]) => {
    const belongs = stage === 'retrieval' ? isRetrieval(name) : isGeneration(name);
    return total + (belongs ? duration : 0);
  }, 0);
}
