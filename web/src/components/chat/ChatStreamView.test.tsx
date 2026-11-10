import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { SearchResult } from '../../types/api';
import { ChatStreamView } from './ChatStreamView';
import type { ChatTurn } from './useRagChat';

const SOURCES: SearchResult[] = [
  {
    chunk_id: 'chunk-1',
    document_id: 'doc-1',
    text: 'Qdrant holds dense vectors for semantic retrieval.',
    score: 0.93,
    retrieval_method: 'dense',
    filename: 'qdrant.md',
    title: 'Dense Memory',
    page_start: 4,
    heading_path: 'Storage > Dense',
  },
  {
    chunk_id: 'chunk-2',
    document_id: 'doc-2',
    text: 'Neo4j holds the knowledge graph.',
    score: 0.82,
    retrieval_method: 'graph',
    filename: 'graph.md',
    title: 'Knowledge Graph',
    page_start: 9,
    heading_path: 'Storage > Graph',
  },
];

let turnCounter = 0;

function makeTurn(overrides: Partial<ChatTurn> = {}): ChatTurn {
  turnCounter += 1;
  return {
    id: `turn-${turnCounter}`,
    query: 'What does Meridian use for retrieval?',
    createdAt: Date.now(),
    status: 'complete',
    answer: 'Meridian combines dense vectors in Qdrant with a Neo4j knowledge graph.',
    sources: SOURCES,
    verified: true,
    refusal: false,
    timings_ms: { dense: 12, llm: 240 },
    execution_time_ms: 1420,
    verification: null,
    ...overrides,
  };
}

describe('ChatStreamView', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the cockpit welcome panel when there are no turns', () => {
    render(<ChatStreamView turns={[]} />);

    expect(screen.getByRole('heading', { name: /meridian dual-memory rag cockpit/i })).toBeInTheDocument();
    expect(screen.getByText(/verified, grounded answers/i)).toBeInTheDocument();
  });

  it('renders the user query and the assistant answer', () => {
    const turn = makeTurn();
    render(<ChatStreamView turns={[turn]} />);

    expect(screen.getByText(turn.query)).toBeInTheDocument();
    expect(
      screen.getByText('Meridian combines dense vectors in Qdrant with a Neo4j knowledge graph.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['retrieving', 'Retrieving relevant context from dual-memory...'],
    ['generating', 'Generating grounded response...'],
    ['verifying', 'Verifying citations and factual consistency...'],
  ] as const)('renders the %s stage indicator while streaming', (stage, label) => {
    render(
      <ChatStreamView
        turns={[
          makeTurn({
            status: stage,
            activeStage: { name: stage, status: 'started' },
            answer: stage === 'generating' ? 'Streaming answer' : '',
          }),
        ]}
        isLoading
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByTestId('active-stage-indicator')).toBeInTheDocument();
  });

  it('announces the active stage through a polite live region', () => {
    render(
      <ChatStreamView
        turns={[
          makeTurn({
            status: 'verifying',
            activeStage: { name: 'verifying', status: 'started' },
            answer: 'Streaming answer',
          }),
        ]}
        isLoading
      />,
    );

    const announcer = screen.getByTestId('stage-announcer');
    expect(announcer).toHaveAttribute('role', 'status');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    expect(announcer).toHaveTextContent('Stage: Verifying citations and factual consistency...');
  });

  it('renders the evidence recovery surface for refusals that still recovered sources', () => {
    const onSelectChunk = vi.fn();
    const turn = makeTurn({
      answer: '',
      verified: false,
      refusal: true,
      degraded_reason: 'No upstream model answered.',
    });
    render(<ChatStreamView turns={[turn]} onSelectChunk={onSelectChunk} />);

    const surface = screen.getByTestId('evidence-recovery-surface');
    expect(surface).toBeInTheDocument();
    expect(
      screen.getByText(/recovered 2 relevant chunks from your index/i),
    ).toBeInTheDocument();

    const inspectButtons = screen.getAllByRole('button', { name: /inspect/i });
    expect(inspectButtons).toHaveLength(2);
    fireEvent.click(inspectButtons[0]);
    expect(onSelectChunk).toHaveBeenCalledWith(SOURCES[0]);
  });

  it('renders the evidence recovery surface for degraded turns with recovered sources', () => {
    render(
      <ChatStreamView
        turns={[makeTurn({ verified: false, refusal: false, degraded_reason: 'LLM timeout' })]}
      />,
    );

    expect(screen.getByTestId('evidence-recovery-surface')).toBeInTheDocument();
    expect(screen.getByText(/recovered 2 relevant chunks from your index/i)).toBeInTheDocument();
  });

  it('does not render the recovery surface when nothing was recovered', () => {
    render(
      <ChatStreamView
        turns={[makeTurn({ refusal: true, verified: false, sources: [] })]}
      />,
    );

    expect(screen.queryByTestId('evidence-recovery-surface')).not.toBeInTheDocument();
  });

  it('ends with a native bottom sentinel for scroll anchoring', () => {
    render(<ChatStreamView turns={[makeTurn()]} />);

    const sentinel = screen.getByTestId('chat-bottom-sentinel');
    expect(sentinel).toBeInTheDocument();
    expect(sentinel.style.overflowAnchor).toBe('auto');
    expect(sentinel.style.height).toBe('1px');
  });

  it('calls onSelectChunk with the first source when the source badge is clicked', () => {
    const onSelectChunk = vi.fn();
    render(<ChatStreamView turns={[makeTurn()]} onSelectChunk={onSelectChunk} />);

    fireEvent.click(screen.getByRole('button', { name: /2 sources/i }));

    expect(onSelectChunk).toHaveBeenCalledWith(SOURCES[0]);
  });

  it('copies the answer text with copied feedback', async () => {
    const turn = makeTurn();
    render(<ChatStreamView turns={[turn]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }));

    expect(writeText).toHaveBeenCalledWith(turn.answer);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('shows the verdict, latency, and source count on a complete turn', () => {
    render(<ChatStreamView turns={[makeTurn()]} />);

    expect(screen.getByText('VERIFIED GROUNDED')).toBeInTheDocument();
    expect(screen.getByText('1.4')).toBeInTheDocument();
    expect(screen.getByText('s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 sources/i })).toBeInTheDocument();
  });

  it.each([
    ['refusal', { verified: false, refusal: true, degraded_reason: null }, 'REFUSED'],
    ['degraded', { verified: false, refusal: false, degraded_reason: 'LLM timeout' }, 'DEGRADED'],
    ['unverified', { verified: false, refusal: false, degraded_reason: null }, 'UNVERIFIED'],
  ] as const)('labels a %s turn with its verdict chip', (_name, overrides, verdict) => {
    render(<ChatStreamView turns={[makeTurn(overrides)]} />);

    expect(screen.getByText(verdict)).toBeInTheDocument();
  });

  it('offers a retry action for an errored turn', () => {
    const onRetryQuery = vi.fn();
    render(
      <ChatStreamView
        turns={[
          makeTurn({
            status: 'error',
            answer: '',
            sources: [],
            verified: false,
            error: { message: 'Backend unavailable', status: 503 },
          }),
        ]}
        onRetryQuery={onRetryQuery}
      />,
    );

    expect(screen.getByText('Backend unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetryQuery).toHaveBeenCalledWith('What does Meridian use for retrieval?');
  });

  describe('Follow-up and Re-run actions', () => {
    it('renders Follow-up and Re-run buttons on a complete turn with an answer', () => {
      const onFollowUp = vi.fn();
      const onRerun = vi.fn();
      render(
        <ChatStreamView
          turns={[makeTurn()]}
          onFollowUp={onFollowUp}
          onRerun={onRerun}
        />,
      );

      expect(screen.getByRole('button', { name: /follow-up/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /re-run/i })).toBeInTheDocument();
    });

    it('calls onFollowUp with the turn when Follow-up button is clicked', () => {
      const onFollowUp = vi.fn();
      const turn = makeTurn();
      render(
        <ChatStreamView
          turns={[turn]}
          onFollowUp={onFollowUp}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /follow-up/i }));
      expect(onFollowUp).toHaveBeenCalledWith(turn);
    });

    it('calls onRerun with the turn when Re-run button is clicked', () => {
      const onRerun = vi.fn();
      const turn = makeTurn();
      render(
        <ChatStreamView
          turns={[turn]}
          onRerun={onRerun}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /re-run/i }));
      expect(onRerun).toHaveBeenCalledWith(turn);
    });

    it('does not render Follow-up and Re-run buttons when turn has no answer', () => {
      const onFollowUp = vi.fn();
      const onRerun = vi.fn();
      render(
        <ChatStreamView
          turns={[makeTurn({ answer: '', status: 'complete' })]}
          onFollowUp={onFollowUp}
          onRerun={onRerun}
        />,
      );

      expect(screen.queryByRole('button', { name: /follow-up/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /re-run/i })).not.toBeInTheDocument();
    });
  });

  describe('Scroll intent detachment and Resume Live Stream pill', () => {
    it('shows Resume Live Stream pill when user scrolls up during streaming', () => {
      const turn = makeTurn({
        status: 'generating',
        activeStage: { name: 'generating', status: 'started' },
        answer: 'Streaming answer',
      });
      const { container: scrollContainer } = render(
        <ChatStreamView
          turns={[turn]}
          isLoading
        />,
      );

      const chatContainer = scrollContainer.querySelector('[data-testid="chat-stream-view"]') as HTMLDivElement;
      Object.defineProperty(chatContainer, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(chatContainer, 'scrollHeight', { value: 1000, writable: true });
      Object.defineProperty(chatContainer, 'clientHeight', { value: 500, writable: true });
      fireEvent.scroll(chatContainer);

      expect(screen.getByTestId('resume-stream-pill')).toBeInTheDocument();
      expect(screen.getByText('Resume Live Stream')).toBeInTheDocument();
    });

    it('clicking Resume Live Stream pill scrolls to bottom and hides pill', () => {
      const turn = makeTurn({
        status: 'generating',
        activeStage: { name: 'generating', status: 'started' },
        answer: 'Streaming answer',
      });
      const { container: scrollContainer } = render(
        <ChatStreamView
          turns={[turn]}
          isLoading
        />,
      );

      const chatContainer = scrollContainer.querySelector('[data-testid="chat-stream-view"]') as HTMLDivElement;
      Object.defineProperty(chatContainer, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(chatContainer, 'scrollHeight', { value: 1000, writable: true });
      Object.defineProperty(chatContainer, 'clientHeight', { value: 500, writable: true });
      fireEvent.scroll(chatContainer);
      expect(screen.getByTestId('resume-stream-pill')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('resume-stream-pill'));
      expect(screen.queryByTestId('resume-stream-pill')).not.toBeInTheDocument();
      expect(chatContainer.scrollTop).toBe(chatContainer.scrollHeight);
    });

    it('does not show Resume Live Stream pill when not streaming', () => {
      const { container: scrollContainer } = render(<ChatStreamView turns={[makeTurn()]} />);

      const chatContainer = scrollContainer.querySelector('[data-testid="chat-stream-view"]') as HTMLDivElement;
      Object.defineProperty(chatContainer, 'scrollTop', { value: 0, writable: true });
      Object.defineProperty(chatContainer, 'scrollHeight', { value: 1000, writable: true });
      Object.defineProperty(chatContainer, 'clientHeight', { value: 500, writable: true });
      fireEvent.scroll(chatContainer);

      expect(screen.queryByTestId('resume-stream-pill')).not.toBeInTheDocument();
    });

    it('does not show Resume Live Stream pill when at bottom during streaming', () => {
      const turn = makeTurn({
        status: 'generating',
        activeStage: { name: 'generating', status: 'started' },
        answer: 'Streaming answer',
      });
      const { container: scrollContainer } = render(
        <ChatStreamView
          turns={[turn]}
          isLoading
        />,
      );

      const chatContainer = scrollContainer.querySelector('[data-testid="chat-stream-view"]') as HTMLDivElement;
      Object.defineProperty(chatContainer, 'scrollTop', { value: 500, writable: true });
      Object.defineProperty(chatContainer, 'scrollHeight', { value: 1000, writable: true });
      Object.defineProperty(chatContainer, 'clientHeight', { value: 500, writable: true });
      fireEvent.scroll(chatContainer);

      expect(screen.queryByTestId('resume-stream-pill')).not.toBeInTheDocument();
    });
  });

  describe('Completion announcer', () => {
    it('announces final verified status and answer summary when turn completes', () => {
      const turn = makeTurn({
        verified: true,
        refusal: false,
        degraded_reason: null,
        execution_time_ms: 1420,
        answer: 'Meridian combines dense vectors in Qdrant with a Neo4j knowledge graph.',
        sources: SOURCES,
      });
      render(<ChatStreamView turns={[turn]} />);

      const announcer = screen.getByTestId('completion-announcer');
      expect(announcer).toHaveAttribute('role', 'status');
      expect(announcer).toHaveAttribute('aria-live', 'polite');
      expect(announcer).toHaveTextContent(/Answer complete. Status: VERIFIED GROUNDED/);
      expect(announcer).toHaveTextContent(/1.4s/);
      expect(announcer).toHaveTextContent(/2 citations/);
      expect(announcer).toHaveTextContent(/Meridian combines dense vectors/);
    });

    it('announces REFUSED status when turn is refused', () => {
      const turn = makeTurn({
        verified: false,
        refusal: true,
        degraded_reason: 'Insufficient grounding',
        execution_time_ms: 500,
        answer: '',
        sources: [],
      });
      render(<ChatStreamView turns={[turn]} />);

      const announcer = screen.getByTestId('completion-announcer');
      expect(announcer).toHaveTextContent(/Status: REFUSED/);
    });

    it('announces DEGRADED status when turn is degraded', () => {
      const turn = makeTurn({
        verified: false,
        refusal: false,
        degraded_reason: 'LLM timeout',
        execution_time_ms: 500,
        answer: 'Partial answer',
        sources: SOURCES,
      });
      render(<ChatStreamView turns={[turn]} />);

      const announcer = screen.getByTestId('completion-announcer');
      expect(announcer).toHaveTextContent(/Status: DEGRADED/);
    });

    it('does not render completion announcer for non-complete turns', () => {
      const turn = makeTurn({
        status: 'generating',
        activeStage: { name: 'generating', status: 'started' },
        answer: 'Streaming...',
      });
      render(<ChatStreamView turns={[turn]} isLoading />);

      expect(screen.queryByTestId('completion-announcer')).not.toBeInTheDocument();
    });

    it('clears completion announcer when turns array changes', () => {
      const turn = makeTurn({ verified: true });
      const { rerender } = render(<ChatStreamView turns={[turn]} />);

      expect(screen.getByTestId('completion-announcer')).toBeInTheDocument();

      rerender(<ChatStreamView turns={[]} />);

      expect(screen.queryByTestId('completion-announcer')).not.toBeInTheDocument();
    });
  });

  describe('TurnFooter timing badges', () => {
    it('renders engine monogram badges when timings are available', () => {
      const turn = makeTurn({
        timings_ms: { dense: 12, graph: 80, llm: 640 },
      });
      render(<ChatStreamView turns={[turn]} />);

      expect(screen.getByText('[VEC:CHROMA 12ms]')).toBeInTheDocument();
      expect(screen.getByText('[KG:SQLITE 80ms]')).toBeInTheDocument();
      expect(screen.getByText('[LLM 640ms]')).toBeInTheDocument();
    });

    it('does not render timing badges when no timings are available', () => {
      const turn = makeTurn({ timings_ms: {} });
      render(<ChatStreamView turns={[turn]} />);

      expect(screen.queryByText(/\[VEC:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\[KG:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\[LLM/)).not.toBeInTheDocument();
    });

    it('renders KV:REDIS badge for sparse_bm25 timing', () => {
      const turn = makeTurn({
        timings_ms: { sparse_bm25: 35 },
      });
      render(<ChatStreamView turns={[turn]} />);

      expect(screen.getByText('[KV:REDIS 35ms]')).toBeInTheDocument();
    });
  });

  describe('Inline citation badges', () => {
    it('calls onSelectChunk when inline citation badge is clicked', async () => {
      const onSelectChunk = vi.fn();
      const turn = makeTurn({
        answer: 'Verified claim from document [^1].',
        sources: SOURCES,
      });

      render(
        <ChatStreamView
          turns={[turn]}
          onSelectChunk={onSelectChunk}
        />,
      );

      const citationButton = await screen.findByRole('button', { name: 'Citation 1' });
      expect(citationButton).toBeInTheDocument();

      fireEvent.click(citationButton);
      expect(onSelectChunk).toHaveBeenCalledWith(SOURCES[0]);
    });
  });
});
