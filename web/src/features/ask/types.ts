/**
 * Meridian — Ask feature contract.
 *
 * Conversation/message shapes, pipeline-stage state and the runtime helpers
 * that turn raw backend payloads into those shapes. The normalizers live here
 * (next to the types they produce) so `useAskStream` and `EvidenceLens` accept
 * exactly the same truth about a chunk or a verification verdict.
 */
import type {
  Entity,
  GuardrailResult,
  QueryResponse,
  SearchResult,
  VerificationSummary,
} from '../../core/types';

/* -------------------------------------------------------------------------- */
/* Conversation                                                               */
/* -------------------------------------------------------------------------- */

export type AskRole = 'user' | 'assistant';

export type AskMessageStatus = 'streaming' | 'complete' | 'error' | 'aborted';

export interface AskMessage {
  id: string;
  role: AskRole;
  /** Markdown for assistant turns, plain text for user turns. */
  content: string;
  createdAt: number;
  /** Set on assistant turns while (and after) streaming. */
  startedAt: number | null;
  completedAt: number | null;
  status: AskMessageStatus;
  /** Full envelope, populated when the terminal SSE frame (or fallback) lands. */
  response: QueryResponse | null;
  sources: SearchResult[];
  verification: VerificationSummary | null;
  pipeline: PipelineStage[];
  elapsedMs: number | null;
  error: string | null;
  degradedReason: string | null;
  refusal: boolean;
  /** True when the SSE transport failed and `POST /v1/query` produced the answer. */
  usedFallback: boolean;
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

export type PipelineStageId = 'guardrail' | 'retrieval' | 'rerank' | 'generation' | 'verification';

export type PipelineStageStatus = 'pending' | 'active' | 'complete' | 'failed';

export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  status: PipelineStageStatus;
  detail: string | null;
  ms: number | null;
}

/* -------------------------------------------------------------------------- */
/* Controls & lens                                                            */
/* -------------------------------------------------------------------------- */

export interface AskControls {
  top_k: number;
  max_cycles: number;
  enforce_guardrails: boolean;
}

export const DEFAULT_ASK_CONTROLS: AskControls = {
  top_k: 8,
  max_cycles: 3,
  enforce_guardrails: true,
};

export const CONTROL_LIMITS = {
  top_k: { min: 1, max: 20 },
  max_cycles: { min: 1, max: 4 },
} as const;

export type EvidenceTab = 'cited' | 'lab' | 'guardrails';

export interface EvidenceLensState {
  open: boolean;
  tab: EvidenceTab;
  /** Assistant message the lens is inspecting; `null` = most recent. */
  messageId: string | null;
  /** 1-based citation marker that was clicked, if any. */
  citation: number | null;
}

export interface SamplePrompt {
  id: string;
  title: string;
  prompt: string;
}

export const SAMPLE_PROMPTS: readonly SamplePrompt[] = [
  {
    id: 'sla',
    title: 'Remediation window',
    prompt: 'What is the remediation window for a Sev-1 incident?',
  },
  {
    id: 'liability',
    title: 'Liability cap',
    prompt: 'Summarise the liability cap and what it excludes.',
  },
  {
    id: 'entities',
    title: 'Shared entities',
    prompt: 'Which entities appear in both the incident policy and the security addendum?',
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Primitive guards                                                           */
/* -------------------------------------------------------------------------- */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = asNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item : String(item))).filter(Boolean);
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asNumber(item, Number.NaN))
    .filter((item): item is number => Number.isFinite(item));
}

/* -------------------------------------------------------------------------- */
/* Search results                                                             */
/* -------------------------------------------------------------------------- */

const RESULT_ENVELOPE_KEYS = [
  'results',
  'chunks',
  'hits',
  'source_chunks',
  'sources',
  'matches',
  'fused',
  'hybrid',
  'dense',
  'sparse',
] as const;

/** One chunk → `SearchResult`, filling every required field defensively. */
function normalizeSearchResult(raw: unknown, index: number): SearchResult | null {
  if (!isRecord(raw)) return null;

  const metadata = isRecord(raw.metadata) ? raw.metadata : {};
  const chunkId = asString(raw.chunk_id ?? raw.id ?? raw.chunkId);
  const text = asString(raw.text ?? raw.content ?? raw.chunk_text);
  if (!chunkId && !text) return null;

  return {
    chunk_id: chunkId || `chunk_${index}`,
    document_id: asString(raw.document_id ?? raw.doc_id ?? raw.documentId),
    text,
    score: asNumber(raw.score ?? raw.relevance_score ?? raw.fused_score, 0),
    retrieval_method: asString(raw.retrieval_method ?? raw.method ?? raw.retriever, 'unknown'),
    metadata,
    rank: asNullableNumber(raw.rank) ?? index + 1,
    filename: asString(raw.filename ?? raw.file_name ?? metadata['filename'], 'unknown'),
    title: asString(raw.title ?? raw.document_title ?? metadata['title'], 'Untitled document'),
    page_start: asNullableNumber(raw.page_start ?? raw.page ?? metadata['page']),
    heading_path: asString(raw.heading_path ?? raw.section ?? raw.heading),
    scores: isRecord(raw.scores) ? raw.scores : {},
    chunk_index: asNullableNumber(raw.chunk_index),
  };
}

/**
 * Normalize anything the backend calls a chunk list: a bare array, an envelope
 * (`results` / `chunks` / `dense` / `hybrid` / …), or a single chunk object.
 */
export function normalizeSearchResults(input: unknown): SearchResult[] {
  if (Array.isArray(input)) {
    return input
      .map((item, index) => normalizeSearchResult(item, index))
      .filter((item): item is SearchResult => item !== null);
  }

  if (isRecord(input)) {
    for (const key of RESULT_ENVELOPE_KEYS) {
      const nested = input[key];
      if (Array.isArray(nested) && nested.length > 0) {
        const normalized = normalizeSearchResults(nested);
        if (normalized.length > 0) return normalized;
      }
    }
    const single = normalizeSearchResult(input, 0);
    return single ? [single] : [];
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

const VERIFICATION_STATUSES = [
  'citations_ok',
  'citations_failed',
  'supported',
  'unsupported',
  'unchecked',
] as const;

const VERIFICATION_SCOPES = [
  'format_and_numeric_consistency',
  'llm_judgment',
  'unchecked',
] as const;

function isVerificationStatus(value: string): value is VerificationSummary['status'] {
  return (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

function isVerificationScope(value: string): value is VerificationSummary['scope'] {
  return (VERIFICATION_SCOPES as readonly string[]).includes(value);
}

/** Always returns a verdict — unknown payloads degrade to `unchecked`. */
export function normalizeVerification(input: unknown): VerificationSummary {
  const raw = isRecord(input) ? input : {};
  const status = asString(raw.status);
  const scope = asString(raw.scope);

  return {
    status: isVerificationStatus(status) ? status : 'unchecked',
    scope: isVerificationScope(scope) ? scope : 'unchecked',
    invalid_citations: asNumberArray(raw.invalid_citations),
    uncited_claims: asStringArray(raw.uncited_claims),
    numeric_mismatches: asStringArray(raw.numeric_mismatches),
    unsupported_claims: asStringArray(raw.unsupported_claims),
    contradictions: asStringArray(raw.contradictions),
    details: raw.details === null || raw.details === undefined ? null : asString(raw.details),
  };
}

/* -------------------------------------------------------------------------- */
/* Query envelope                                                             */
/* -------------------------------------------------------------------------- */

function normalizeEntities(input: unknown): Entity[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item): Entity[] => {
    if (!isRecord(item)) return [];
    const name = asString(item.name);
    if (!name) return [];
    return [
      {
        name,
        normalized_name: asString(item.normalized_name, name.toLowerCase()),
        entity_type: asString(item.entity_type, 'unknown'),
        properties: isRecord(item.properties) ? item.properties : {},
        document_ids: asStringArray(item.document_ids),
        chunk_ids: asStringArray(item.chunk_ids),
      },
    ];
  });
}

/**
 * A terminal SSE frame may carry the whole envelope, a partial one, or only an
 * answer string. This produces a complete `QueryResponse` either way, so callers
 * never have to guard field-by-field.
 */
export function normalizeQueryResponse(input: unknown): QueryResponse | null {
  if (!isRecord(input)) return null;

  const sourceChunks = normalizeSearchResults(input.source_chunks ?? input.sources);
  const sources = normalizeSearchResults(input.sources ?? input.source_chunks);
  const verification = normalizeVerification(input.verification);
  const answer = asString(input.answer);

  const looksLikeResponse =
    typeof input.answer === 'string' ||
    sourceChunks.length > 0 ||
    isRecord(input.verification) ||
    typeof input.verified === 'boolean' ||
    typeof input.answer_status === 'string';

  if (!looksLikeResponse) return null;

  const serving = isRecord(input.serving) ? input.serving : {};
  const review = isRecord(input.review_status) ? input.review_status : {};
  const timings = isRecord(input.timings_ms) ? input.timings_ms : {};

  const timingsMs: Record<string, number> = {};
  for (const [key, value] of Object.entries(timings)) {
    const parsed = asNumber(value, Number.NaN);
    if (Number.isFinite(parsed)) timingsMs[key] = parsed;
  }

  return {
    query: asString(input.query),
    answer,
    source_chunks: sourceChunks,
    entities: normalizeEntities(input.entities),
    cycle_count: asNumber(input.cycle_count, 0),
    verified: input.verified === true,
    refusal: input.refusal === true,
    execution_time_ms: asNumber(input.execution_time_ms, 0),
    degraded_reason:
      input.degraded_reason === null || input.degraded_reason === undefined
        ? null
        : asString(input.degraded_reason),
    serving_provider:
      input.serving_provider === null || input.serving_provider === undefined
        ? null
        : asString(input.serving_provider),
    serving_model:
      input.serving_model === null || input.serving_model === undefined
        ? null
        : asString(input.serving_model),
    serving: {
      provider:
        serving.provider === null || serving.provider === undefined
          ? null
          : asString(serving.provider),
      model:
        serving.model === null || serving.model === undefined ? null : asString(serving.model),
      fresh: serving.fresh === true,
    },
    answer_status: asString(input.answer_status, 'answered'),
    verification,
    sources,
    request_id:
      input.request_id === null || input.request_id === undefined
        ? null
        : asString(input.request_id),
    trace_id:
      input.trace_id === null || input.trace_id === undefined ? null : asString(input.trace_id),
    review_status: { flagged_chunk_ids: asStringArray(review.flagged_chunk_ids) },
    timings_ms: timingsMs,
    usage: isRecord(input.usage) ? input.usage : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Guardrails                                                                 */
/* -------------------------------------------------------------------------- */

export function normalizeGuardrailResult(input: unknown): GuardrailResult | null {
  if (!isRecord(input)) return null;
  const hasSignal =
    typeof input.allowed === 'boolean' ||
    typeof input.sanitized_text === 'string' ||
    Array.isArray(input.policy_violations);
  if (!hasSignal) return null;

  return {
    allowed: input.allowed === true,
    sanitized_text: asString(input.sanitized_text),
    policy_violations: asStringArray(input.policy_violations),
    action_taken: asString(input.action_taken, input.allowed === true ? 'allow' : 'block'),
  };
}
