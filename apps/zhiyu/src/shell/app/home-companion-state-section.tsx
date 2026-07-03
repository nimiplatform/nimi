import { Activity } from 'lucide-react';
import { StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type { ZhiyuEvidence } from './evidence';
import type { ZhiyuHomeGatedSurface } from './home-product-state';
import { formatZhiyuObservedAtLabel } from './product-format';

export function CompanionStateSection({
  surface,
  companion,
}: {
  readonly surface: ZhiyuHomeGatedSurface;
  readonly companion: ZhiyuEvidence['companion'];
}) {
  const projectedFields = companion.projectedFields.length;
  const proactive = companion.proactiveInterruptibility;
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__companion-state"
      data-zhiyu-region="companion"
      data-zhiyu-gated-surface="companion"
      data-zhiyu-companion-state={companion.state}
      data-zhiyu-companion-ready={String(companion.ready)}
      data-zhiyu-companion-reason={companion.reasonCode}
      data-zhiyu-companion-status-text={companion.statusText ?? 'not_projected'}
      data-zhiyu-companion-state-updated-at={companion.stateUpdatedAt ?? 'not_projected'}
      data-zhiyu-companion-current-emotion={companion.currentEmotion ?? 'not_projected'}
      data-zhiyu-companion-participation-mode={companion.participationMode}
      data-zhiyu-companion-participation-source={companion.participationSource ?? 'not_projected'}
      data-zhiyu-companion-projected-count={String(projectedFields)}
      data-zhiyu-proactive-state={proactive.state}
      data-zhiyu-proactive-mode={proactive.mode ?? 'not_projected'}
      data-zhiyu-proactive-opt-in-state={proactive.optInState ?? 'not_projected'}
      data-zhiyu-proactive-delivery-channel={proactive.deliveryChannel ?? 'not_projected'}
      data-zhiyu-proactive-quiet-hours={proactive.quietHoursState ?? 'not_projected'}
      data-zhiyu-proactive-frequency-cap={proactive.frequencyCapState ?? 'not_projected'}
      data-zhiyu-proactive-suppression-reason={proactive.lastSuppressionReason ?? 'not_projected'}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <Activity size={18} aria-hidden="true" />
        <div>
          <h2>{surface.title}</h2>
          <p>{surface.description}</p>
        </div>
      </div>
      <div className="zhiyu-home__companion-summary">
        <StatusBadge tone={companion.ready ? 'success' : 'warning'} shape="dot">
          {companion.ready ? '状态已更新' : '等待伙伴状态'}
        </StatusBadge>
        <span>{projectedFields} 项可见摘要</span>
        <span data-zhiyu-companion-observed-at={companion.observedAt ?? 'not_projected'}>
          {formatZhiyuObservedAtLabel(companion.observedAt)}
        </span>
      </div>
      {companion.ready ? (
        <div className="zhiyu-home__companion-grid" aria-label="伙伴状态摘要">
          <CompanionStateField label="执行状态" value={companionExecutionLabel(companion.executionState)} />
          <CompanionStateField label="状态说明" value={companionStateValue(companion.statusText)} />
          <CompanionStateField label="所在世界" value={companionStateValue(companion.activeWorldId)} />
          <CompanionStateField label="当前用户" value={companionStateValue(companion.activeUserId)} />
          <CompanionStateField
            label="更新时间"
            value={companion.stateUpdatedAt ? formatZhiyuObservedAtLabel(companion.stateUpdatedAt) : null}
          />
          <CompanionStateField label="当前情绪" value={companionStateValue(companion.currentEmotion)} />
          <CompanionStateField label="参与模式" value={companionParticipationLabel(companion.participationMode)} />
          <CompanionStateField label="参与来源" value={companionParticipationSourceLabel(companion.participationSource)} />
        </div>
      ) : (
        <div className="zhiyu-home__companion-empty">
          <strong>等待当前伙伴状态</strong>
          <span>选择本地伙伴后，这里会显示状态、情绪和参与方式。</span>
        </div>
      )}
      {companion.ready || proactive.ready ? <ProactiveInterruptibilityPanel proactive={proactive} /> : null}
      <div
        className="zhiyu-home__companion-hidden-evidence"
        aria-hidden="true"
        data-zhiyu-companion-unsupported-fields={companion.unsupportedExplainabilityFields.join(',')}
      />
    </Surface>
  );
}

function ProactiveInterruptibilityPanel({
  proactive,
}: {
  readonly proactive: ZhiyuEvidence['companion']['proactiveInterruptibility'];
}) {
  return (
    <div
      className="zhiyu-home__proactive"
      aria-label="主动打扰设置"
      data-zhiyu-proactive-interruptibility={proactive.state}
      data-zhiyu-proactive-ready={String(proactive.ready)}
      data-zhiyu-proactive-delivery-ready={String(proactive.deliveryReady)}
      data-zhiyu-proactive-reason={proactive.reasonCode}
      data-zhiyu-proactive-suggested-reason={proactive.suggestedReasonCode ?? 'not_projected'}
      data-zhiyu-proactive-delivered-reason={proactive.lastDeliveredReasonCode ?? 'not_projected'}
      data-zhiyu-proactive-suppressed-reason={proactive.lastSuppressedReasonCode ?? 'not_projected'}
      data-zhiyu-proactive-source-hook={proactive.sourceHookId ?? 'not_projected'}
      data-zhiyu-proactive-source-cadence={proactive.sourceCadenceId ?? 'not_projected'}
    >
      <div className="zhiyu-home__proactive-heading">
        <StatusBadge tone={proactive.deliveryReady ? 'success' : proactive.ready ? 'info' : 'warning'} shape="dot">
          {proactiveStateLabel(proactive.state)}
        </StatusBadge>
        <span>{proactive.deliveryReady ? '可主动送达' : '主动提醒尚未配置'}</span>
      </div>
      <div className="zhiyu-home__proactive-grid">
        <ProactiveField label="模式" value={proactive.mode} />
        <ProactiveField label="授权" value={proactive.optInState} />
        <ProactiveField label="送达渠道" value={proactive.deliveryChannel} />
        <ProactiveField label="安静时段" value={proactive.quietHoursState} />
        <ProactiveField label="频率限制" value={proactive.frequencyCapState} />
        <ProactiveField label="抑制原因" value={proactive.lastSuppressionReason} />
      </div>
      <ProactiveAuditRefs refs={proactive.auditRefs} />
      <div className="zhiyu-home__proactive-unsupported" aria-label="主动打扰未开放字段">
        {proactive.unsupportedFields.map((field) => (
          <span
            key={field}
            data-zhiyu-proactive-unsupported-field={field}
            data-zhiyu-proactive-unsupported-state="not_projected"
          >
            {companionFieldLabel(field)}：尚未开放
          </span>
        ))}
      </div>
    </div>
  );
}

function ProactiveField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <span
      data-zhiyu-proactive-field={label}
      data-zhiyu-proactive-field-state={value ? 'projected' : 'not_projected'}
    >
      {label}：{companionStateValue(value) ?? '尚未配置'}
    </span>
  );
}

function ProactiveAuditRefs({ refs }: { readonly refs: readonly string[] }) {
  if (refs.length === 0) {
    return (
      <div className="zhiyu-home__proactive-audit" data-zhiyu-proactive-audit-state="empty">
        <span data-zhiyu-proactive-audit-ref="not_projected">审计：尚未开放</span>
      </div>
    );
  }
  return (
    <div className="zhiyu-home__proactive-audit" data-zhiyu-proactive-audit-state="projected">
      {refs.map((ref) => (
        <span key={ref} data-zhiyu-proactive-audit-ref={ref}>
          审计：已记录
        </span>
      ))}
    </div>
  );
}

function CompanionStateField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div
      className="zhiyu-home__companion-item"
      data-zhiyu-companion-field={label}
      data-zhiyu-companion-field-state={value ? 'projected' : 'not_projected'}
    >
      <span>{label}</span>
      <strong>{value ?? '尚未配置'}</strong>
    </div>
  );
}

function companionStateValue(value: string | null): string | null {
  if (!value || value === 'not_projected') return null;
  if (value === 'not_admitted') return '尚未开放';
  return value.replaceAll('_', ' ');
}

function companionExecutionLabel(value: string | null): string | null {
  if (!value || value === 'not_projected') return null;
  if (value === 'idle') return '安静陪伴';
  if (value === 'running' || value === 'active') return '正在互动';
  return companionStateValue(value);
}

function companionParticipationLabel(value: string | null): string | null {
  if (!value || value === 'not_projected') return null;
  if (value === 'idle') return '待命';
  if (value === 'active' || value === 'participating') return '参与中';
  return companionStateValue(value);
}

function companionParticipationSourceLabel(value: string | null): string | null {
  if (!value || value === 'not_projected') return null;
  if (value === 'runtime-agent-state') return '本地服务';
  return companionStateValue(value);
}

function proactiveStateLabel(state: string): string {
  if (state === 'ready') return '已就绪';
  if (state === 'blocked') return '等待开放';
  if (state === 'not-probed') return '等待检查';
  return state.replaceAll('_', ' ');
}

function companionFieldLabel(field: string): string {
  if (field === 'posture') return '姿态';
  if (field === 'postureSource') return '姿态来源';
  if (field === 'stateConfidence') return '状态置信度';
  if (field === 'whyThisState') return '状态原因';
  if (field === 'relationshipContext') return '关系上下文';
  if (field === 'diaryReflection') return '日记回顾';
  if (field === 'stateChangeHistory') return '状态历史';
  if (field === 'proactive_interruptibility') return '主动打扰';
  return field.replaceAll('_', ' ');
}
