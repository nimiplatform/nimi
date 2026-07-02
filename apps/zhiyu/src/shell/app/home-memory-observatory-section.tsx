import { StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { Database } from 'lucide-react';
import type { ZhiyuEvidence } from './evidence';
import type { ZhiyuHomeGatedSurface } from './home-product-state';

export function MemoryObservatorySection({
  surface,
  memory,
}: {
  readonly surface: ZhiyuHomeGatedSurface;
  readonly memory: ZhiyuEvidence['memory'];
}) {
  const visibleRecords = memory.records.slice(0, 3);
  const visibleReviewStatuses = memory.bankReviewStatuses.slice(0, 3);
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__memory-observatory"
      data-zhiyu-region="memory"
      data-zhiyu-gated-surface="memory"
      data-zhiyu-memory-observatory="runtime-agent-memory-projection"
      data-zhiyu-memory-state={memory.state}
      data-zhiyu-memory-ready={String(memory.ready)}
      data-zhiyu-memory-reason={memory.reasonCode}
      data-zhiyu-memory-record-count={String(memory.recordCount)}
      data-zhiyu-memory-bank-count={String(memory.bankCount)}
      data-zhiyu-memory-review-count={String(memory.bankReviewStatuses.length)}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <Database size={18} aria-hidden="true" />
        <div>
          <h2>{surface.title}</h2>
          <p>{surface.description}</p>
        </div>
      </div>
      <div className="zhiyu-home__memory-summary">
        <StatusBadge tone={memory.ready ? 'success' : 'warning'} shape="dot">
          {memory.ready ? '已同步' : '等待记忆投影'}
        </StatusBadge>
        <span>{memory.recordCount} records</span>
        <span>{memory.bankCount} banks</span>
        <span>{memory.observedAt ?? 'not observed'}</span>
      </div>
      {visibleRecords.length > 0 ? (
        <div className="zhiyu-home__memory-list" aria-label="Memory Observatory records">
          {visibleRecords.map((record) => {
            const confidenceValue = formatMemoryConfidenceValue(record.confidence.value);
            const lineageEvent = record.lineage.sourceEventId ?? 'not_projected';
            return (
              <div
                key={record.memoryId}
                className="zhiyu-home__memory-record"
                data-zhiyu-memory-record={record.memoryId}
                data-zhiyu-memory-record-kind={record.kind ?? 'unknown'}
                data-zhiyu-memory-record-timeline={record.timelineAt ?? 'not_projected'}
                data-zhiyu-memory-record-lineage-source={record.lineage.sourceSystem ?? 'not_projected'}
                data-zhiyu-memory-record-lineage-event={lineageEvent}
                data-zhiyu-memory-record-lineage-trace={record.lineage.traceId ?? 'not_projected'}
                data-zhiyu-memory-record-confidence={record.confidence.state}
                data-zhiyu-memory-record-confidence-value={confidenceValue}
                data-zhiyu-memory-record-review-state={record.reviewState}
                data-zhiyu-memory-record-redaction-state={record.redactionState}
                data-zhiyu-memory-record-forget-intent-state={record.forgetIntentState}
              >
                <div>
                  <strong>{record.summary}</strong>
                  <small
                    data-zhiyu-memory-lineage={lineageEvent}
                    data-zhiyu-memory-lineage-trace={record.lineage.traceId ?? 'not_projected'}
                  >
                    {(record.timelineAt ?? 'timeline_not_projected') + ' | ' + lineageEvent}
                  </small>
                  <div className="zhiyu-home__memory-record-meta">
                    <span>confidence {confidenceValue}</span>
                    <span>review {record.reviewState}</span>
                    <span>redaction {record.redactionState}</span>
                    <span>forget {record.forgetIntentState}</span>
                  </div>
                </div>
                <StatusBadge tone={record.confidence.state === 'available' ? 'success' : 'info'} shape="dot">
                  {record.payloadKind}
                </StatusBadge>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="zhiyu-home__memory-empty" data-zhiyu-memory-empty={memory.state}>
          <strong>{memory.state}</strong>
          <small>{memory.message}</small>
        </div>
      )}
      {visibleReviewStatuses.length > 0 ? (
        <div className="zhiyu-home__memory-review-status" aria-label="Memory bank review readiness">
          {visibleReviewStatuses.map((status) => (
            <span
              key={status.bankKey}
              data-zhiyu-memory-bank-review-status={status.bankKey}
              data-zhiyu-memory-bank-review-readiness={status.readiness}
              data-zhiyu-memory-bank-review-eligible={String(status.eligibleNow)}
            >
              {status.readiness}
            </span>
          ))}
        </div>
      ) : null}
      <div className="zhiyu-home__memory-lifecycle" aria-label="Memory lifecycle projection">
        {memory.unsupportedLifecycleFields.map((field) => (
          <span
            key={field}
            data-zhiyu-memory-lifecycle-field={field}
            data-zhiyu-memory-lifecycle-state="not_projected"
          >
            {memoryLifecycleLabel(field)}
          </span>
        ))}
      </div>
      <div
        className="zhiyu-home__memory-graph"
        data-zhiyu-memory-graph-state="not_projected"
        data-zhiyu-memory-graph-reason="runtime-agent-memory-graph-relations-not-admitted"
      >
        <span>graph-lite</span>
        <strong>等待图谱投影</strong>
        <small>Runtime memory graph 尚未准入</small>
      </div>
      <p className="zhiyu-home__action-hint">{memory.actionHint}</p>
    </Surface>
  );
}

function formatMemoryConfidenceValue(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : 'not_projected';
}

function memoryLifecycleLabel(field: string): string {
  if (field === 'review') {
    return '复核策略等待 Runtime 开放';
  }
  if (field === 'redaction') {
    return '脱敏策略等待 Runtime 开放';
  }
  if (field === 'forgetIntent') {
    return '遗忘意图等待 Runtime 开放';
  }
  return `${field} 等待 Runtime 开放`;
}
