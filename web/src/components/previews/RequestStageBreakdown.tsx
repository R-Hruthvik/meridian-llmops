import { formatDuration, stageMilliseconds } from './previewData';
import type { TenantMetrics } from '../../types/api';

type RequestSample = TenantMetrics['recent_requests'][number];

export default function RequestStageBreakdown({ request }: { request?: RequestSample }) {
  if (!request) return null;
  const retrieval = stageMilliseconds(request.timings_ms, 'retrieval');
  const generation = stageMilliseconds(request.timings_ms, 'generation');
  const total = Math.max(retrieval + generation, 1);
  return <section className="request-stage-breakdown" aria-label="Latest request stage timings">
    <div className="request-stage-heading"><h2>Latest request stages</h2><span>Measured · milliseconds and seconds</span></div>
    <div className="request-stage-row"><div><span>Retrieval</span><b>{formatDuration(retrieval)}</b></div><div className="request-stage-track"><i className="retrieval" style={{ width: `${retrieval / total * 100}%` }} /></div></div>
    <div className="request-stage-row"><div><span>Generation</span><b>{formatDuration(generation)}</b></div><div className="request-stage-track"><i className="generation" style={{ width: `${generation / total * 100}%` }} /></div></div>
    <p>From the most recent recorded request · total {formatDuration(request.duration_ms)}</p>
  </section>;
}
