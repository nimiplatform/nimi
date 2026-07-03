import { StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { Database } from 'lucide-react';
import type { ZhiyuEvidence } from './evidence';
import type { ZhiyuHomeGatedSurface } from './home-product-state';
import { formatZhiyuObservedAtLabel } from './product-format';

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
          {memory.ready ? '记忆已更新' : '等待记忆摘要'}
        </StatusBadge>
        <span>{memory.recordCount} 条记忆</span>
        <span>{memory.bankCount} 个分区</span>
        <span data-zhiyu-memory-observed-at={memory.observedAt ?? 'not_projected'}>
          {formatZhiyuObservedAtLabel(memory.observedAt)}
        </span>
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
                    {record.timelineAt ? formatZhiyuObservedAtLabel(record.timelineAt) : '时间待确认'}
                  </small>
                  <div className="zhiyu-home__memory-record-meta">
                    <span>{confidenceValue === 'not_projected' ? '置信度待确认' : `置信度 ${confidenceValue}`}</span>
                    <span>{memoryReviewStateLabel(record.reviewState)}</span>
                    <span>{memoryRedactionStateLabel(record.redactionState)}</span>
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
          <strong>{memoryEmptyTitle(memory)}</strong>
          <small>{memoryEmptyDescription(memory)}</small>
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
      <div
        className="zhiyu-home__memory-hidden-evidence"
        aria-hidden="true"
        data-zhiyu-memory-graph-state="not_projected"
        data-zhiyu-memory-graph-reason="runtime-agent-memory-graph-relations-not-admitted"
        data-zhiyu-memory-lifecycle-fields={memory.unsupportedLifecycleFields.join(',')}
      />
    </Surface>
  );
}

function formatMemoryConfidenceValue(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(2)
    : 'not_projected';
}

function memoryEmptyTitle(memory: ZhiyuEvidence['memory']): string {
  if (memory.state === 'empty') {
    return '还没有可展示的记忆';
  }
  if (memory.state === 'denied' || memory.state === 'grant-missing') {
    return '记忆访问尚未授权';
  }
  if (memory.state === 'runtime-unavailable') {
    return '记忆服务暂不可用';
  }
  if (memory.state === 'partial') {
    return '记忆结果暂不完整';
  }
  return '还没有可展示的记忆摘要';
}

function memoryEmptyDescription(memory: ZhiyuEvidence['memory']): string {
  if (memory.state === 'empty') {
    return '本地服务已可读取记忆，但当前伙伴还没有可展示的记录。';
  }
  if (memory.state === 'denied' || memory.state === 'grant-missing') {
    return '授权完成后，这里会显示只读记忆摘要。';
  }
  if (memory.state === 'partial') {
    return '当前只收到部分结果，完整原因保留在诊断中。';
  }
  return '会话和伙伴准备好后，这里会显示只读记忆摘要。';
}

function memoryReviewStateLabel(value: string): string {
  if (value === 'reviewed') return '已复核';
  if (value === 'pending') return '待复核';
  return '复核待确认';
}

function memoryRedactionStateLabel(value: string): string {
  if (value === 'redacted') return '已脱敏';
  if (value === 'none') return '无需脱敏';
  return '脱敏待确认';
}
