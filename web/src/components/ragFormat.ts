import type { ChatTurn } from './chat/useRagChat';

export const formatLatency = (ms: number): { value: string; unit: string } => {
  if (!Number.isFinite(ms)) return { value: '—', unit: 'ms' };
  const rounded = Math.round(ms);
  if (Math.abs(rounded) < 1000) return { value: String(rounded), unit: 'ms' };
  return { value: (ms / 1000).toFixed(1), unit: 's' };
};

export const shortId = (id: string | undefined | null, keep = 8): string => {
  if (!id) return '—';
  if (id.length <= keep) return id;
  return `${id.slice(0, keep)}…`;
};

export function generateAuditLogMarkdown(tenantId: string, turns: ChatTurn[]): string {
  const lines: string[] = [
    `# Meridian Enterprise RAG — Session Audit Log`,
    ``,
    `- **Tenant:** ${tenantId}`,
    `- **Exported:** ${new Date().toISOString()}`,
    `- **Turns Recorded:** ${turns.length}`,
    ``,
    `---`,
    ``,
  ];

  turns.forEach((turn, idx) => {
    lines.push(`## Turn #${idx + 1}: ${turn.query}`);
    lines.push(`- **Status:** ${turn.status.toUpperCase()}`);
    if (turn.execution_time_ms) {
      lines.push(`- **Execution Latency:** ${Math.round(turn.execution_time_ms)} ms`);
    }
    if (turn.timings_ms && Object.keys(turn.timings_ms).length > 0) {
      const timingParts = Object.entries(turn.timings_ms)
        .map(([k, v]) => `${k}: ${Math.round(v)}ms`)
        .join(', ');
      lines.push(`- **Telemetry Breakdown:** ${timingParts}`);
    }
    lines.push(``);
    lines.push(`### Answer`);
    lines.push(turn.answer.trim() || '*(No answer generated)*');
    lines.push(``);

    if (turn.sources.length > 0) {
      lines.push(`### Cited Sources (${turn.sources.length})`);
      turn.sources.forEach((source, sIdx) => {
        const title = source.title || source.filename || source.document_id || `Source #${sIdx + 1}`;
        const score = Number.isFinite(source.score) ? ` (Score: ${source.score.toFixed(2)})` : '';
        lines.push(`#### [^${sIdx + 1}] ${title}${score}`);
        if (source.text) {
          lines.push(`> ${source.text.replace(/\n/g, '\n> ')}`);
        }
        lines.push(``);
      });
    }
    lines.push(`---`);
    lines.push(``);
  });

  return lines.join('\n');
}

