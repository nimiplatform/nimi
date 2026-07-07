import {
  AgentCenter,
  type AgentCenterAppearanceProjection,
  type AgentCenterSectionId,
  type AgentCenterStateInput,
} from '@nimiplatform/kit/features/agent-center';
import type {
  NimiRuntimeAgentCanonicalMemoryInspect,
  NimiRuntimeAgentExecutionConfigBindings,
  NimiRuntimeAgentExecutionReadinessReasonCode,
  NimiRuntimeAgentInspectSnapshot,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  AppCardSurface,
  IconToggleAction,
} from '@nimiplatform/kit/ui';
import { X } from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  agentCenterLocalAgentRef,
  agentCenterWorldLabel,
  partnerInitial,
} from './ZhiyuAgentChatLabels';

export type RightPanelMode = 'agent' | 'closed';
export type VisibleRightPanelMode = Exclude<RightPanelMode, 'closed'>;
export type AgentPanelTab = AgentCenterSectionId;

type RightAgentPanelProps = {
  readonly mode: VisibleRightPanelMode;
  readonly evidence: ZhiyuEvidence;
  readonly currentPartnerName: string;
  readonly activeTab: AgentPanelTab;
  readonly onActiveTabChange: (tab: AgentPanelTab) => void;
  readonly onClose: () => void;
  readonly onOpenModelConfig: () => void;
  readonly onAvatarLaunch?: () => void;
};

export function RightAgentPanel(props: RightAgentPanelProps) {
  const agentCenterRef = agentCenterLocalAgentRef(props.evidence);
  const agentCenterWorld = agentCenterWorldLabel(props.evidence);
  const state = buildZhiyuAgentCenterState(props.evidence);

  return (
    <aside
      className="zhiyu-agent-center mr-2 my-12 flex h-[calc(100vh-96px)] min-h-0 w-[min(500px,calc(100vw-96px))] max-w-full shrink-0 [grid-area:side] max-[980px]:my-0 max-[980px]:mr-0 max-[980px]:h-auto max-[980px]:min-h-[min(640px,calc(100vh-20px))] max-[980px]:w-full"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-center-placement="kit"
      data-zhiyu-agent-panel-mode={props.mode}
      data-zhiyu-agent-center-side-sheet="desktop"
      aria-label="Agent Center placement"
    >
      <AppCardSurface
        kind="promoted-glass"
        as="section"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div
          className="zhiyu-agent-center__header flex items-start gap-3 border-b border-white/70 px-4 pb-3 pt-7"
          data-zhiyu-agent-center-header="true"
          data-zhiyu-agent-center-owner="kit-placement"
        >
          <span className="zhiyu-agent-center__avatar grid h-14 w-14 shrink-0 place-items-center rounded-[18px] border border-emerald-300/70 bg-emerald-500/20 text-[18px] font-semibold text-emerald-900 shadow-[0_0_0_3px_rgba(168,85,247,0.28)]" aria-hidden="true">
            {partnerInitial(props.currentPartnerName)}
          </span>
          <div className="zhiyu-agent-center__title min-w-0 flex-1">
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase text-[var(--nimi-text-muted)]" data-zhiyu-agent-center-eyebrow="AGENT CENTER">AGENT CENTER</span>
            <strong className="m-0 block truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{props.currentPartnerName}</strong>
            <div className="zhiyu-agent-center__meta mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              {agentCenterRef ? (
                <small
                  className="max-w-[250px] truncate font-mono text-[11.5px] text-[var(--nimi-text-secondary)]"
                  data-zhiyu-agent-center-local-agent-ref={agentCenterRef}
                  title={agentCenterRef}
                >
                  {agentCenterRef}
                </small>
              ) : (
                <small className="max-w-[250px] truncate font-mono text-[11.5px] text-[var(--nimi-text-secondary)]" data-zhiyu-agent-center-local-agent-ref="not_selected">
                  not selected
                </small>
              )}
              {agentCenterWorld ? (
                <em className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,#a855f7_30%,transparent)] bg-[color-mix(in_srgb,#a855f7_8%,transparent)] px-2 py-px text-[10.5px] font-medium not-italic text-[#7c3aed]" data-zhiyu-agent-center-world-chip="true">
                  {agentCenterWorld}
                </em>
              ) : null}
            </div>
          </div>
          <IconToggleAction
            type="button"
            aria-label="Close Agent Center"
            title="Close panel"
            data-zhiyu-agent-panel-close="true"
            onClick={props.onClose}
            icon={<X size={16} aria-hidden="true" />}
          />
        </div>
        <div
          className="zhiyu-agent-center__body grid flex-1 content-start gap-3 overflow-auto px-5 py-3"
          data-zhiyu-agent-panel-tab={props.activeTab}
          data-zhiyu-agent-center-kit-surface="true"
        >
          <AgentCenter
            ariaLabel="Zhiyu Agent Center"
            activeSection={props.activeTab}
            onSectionChange={props.onActiveTabChange}
            placementActions={{
              close: props.onClose,
              openRuntimeSettings: props.onOpenModelConfig,
              launchAvatar: props.onAvatarLaunch,
            }}
            state={state}
          />
        </div>
      </AppCardSurface>
    </aside>
  );
}

export function buildZhiyuAgentCenterState(evidence: ZhiyuEvidence): AgentCenterStateInput {
  return {
    executionConfig: buildExecutionConfig(evidence),
    readiness: buildReadiness(evidence),
    inspect: buildInspect(evidence),
    runtimeError: evidence.runtime.ready ? null : `${evidence.runtime.reasonCode}: ${evidence.runtime.message}`,
    autonomyMutationAvailable: false,
    appearance: buildAppearance(evidence),
  };
}

function buildExecutionConfig(evidence: ZhiyuEvidence): AgentCenterStateInput['executionConfig'] {
  if (evidence.route.configRevision === null) {
    return null;
  }
  const bindings: Record<string, NimiRuntimeAgentExecutionConfigBindings[string]> = {};
  for (const [capability, projection] of Object.entries(evidence.route.capabilities)) {
    if (projection.binding) {
      bindings[capability] = projection.binding;
    }
  }
  if (evidence.route.executionBinding && !bindings['text.generate']) {
    bindings['text.generate'] = evidence.route.executionBinding;
  }
  return {
    revision: evidence.route.configRevision,
    bindings,
    updatedAt: evidence.route.updatedAt,
    updatedByAppId: evidence.route.updatedByAppId || 'runtime',
  };
}

function buildReadiness(evidence: ZhiyuEvidence): AgentCenterStateInput['readiness'] {
  const capabilities = Object.entries(evidence.route.capabilities);
  if (evidence.route.readinessRevision === null && capabilities.length === 0) {
    return null;
  }
  return {
    configRevision: evidence.route.readinessRevision ?? evidence.route.configRevision ?? 0,
    capabilities: capabilities.map(([capability, projection]) => ({
      capability,
      state: projection.state,
      reasonCode: normalizeReadinessReasonCode(projection.reasonCode),
      probedAt: projection.probedAt,
    })),
  };
}

function buildInspect(evidence: ZhiyuEvidence): NimiRuntimeAgentInspectSnapshot | null {
  if (!evidence.localAgent.ready && !evidence.companion.ready && !evidence.memory.ready && !evidence.avatar.ready) {
    return null;
  }
  const proactive = evidence.companion.proactiveInterruptibility;
  return {
    executionState: evidence.companion.executionState,
    statusText: evidence.companion.statusText,
    activeWorldId: evidence.companion.activeWorldId,
    activeUserId: evidence.companion.activeUserId,
    updatedAt: evidence.companion.stateUpdatedAt,
    currentEmotion: evidence.companion.currentEmotion,
    proactiveInterruptibility: buildProactiveProjection(evidence),
    lifecycleStatus: evidence.localAgent.ready ? evidence.localAgent.reasonCode : null,
    presentationProfile: null,
    autonomyMode: proactive.mode,
    autonomyEnabled: proactive.mode ? proactive.mode !== 'off' : null,
    autonomyBudgetExhausted: proactive.frequencyCapState === 'capped',
    autonomyUsedTokensInWindow: null,
    autonomyDailyTokenBudget: null,
    autonomyMaxTokensPerHook: null,
    autonomyWindowStartedAt: null,
    autonomySuspendedUntil: null,
    pendingHooksCount: 0,
    nextScheduledFor: null,
    pendingHooks: [],
    recentTerminalHooks: [],
    recentCanonicalMemories: evidence.memory.records.map(toCanonicalMemoryInspect),
  };
}

function buildProactiveProjection(evidence: ZhiyuEvidence): NimiRuntimeAgentInspectSnapshot['proactiveInterruptibility'] {
  const proactive = evidence.companion.proactiveInterruptibility;
  return {
    projectionId: proactive.projectionId,
    projectionKind: proactive.projectionKind,
    mode: proactive.mode,
    optInState: proactive.optInState,
    deliveryChannel: proactive.deliveryChannel,
    quietHoursState: proactive.quietHoursState,
    frequencyCapState: proactive.frequencyCapState,
    suggestedEvent: null,
    lastDeliveredEvent: null,
    lastSuppressedEvent: null,
    auditRefs: proactive.auditRefs,
    unsupportedFields: proactive.unsupportedFields,
  };
}

function toCanonicalMemoryInspect(
  memory: ZhiyuEvidence['memory']['records'][number],
): NimiRuntimeAgentCanonicalMemoryInspect {
  return {
    memoryId: memory.memoryId,
    canonicalClass: memory.canonicalClass,
    kind: memory.kind,
    summary: memory.summary,
    updatedAt: memory.lineage.committedAt ?? memory.timelineAt,
    sourceEventId: memory.lineage.sourceEventId,
    policyReason: memory.confidence.reasonCode,
    recallScore: null,
  };
}

function buildAppearance(evidence: ZhiyuEvidence): AgentCenterAppearanceProjection {
  const avatarAssetRef = evidence.avatar.projectionRef || evidence.avatar.configurationRef || null;
  const status: AgentCenterAppearanceProjection['status'] = evidence.avatar.ready || evidence.avatar.visualReadiness === 'projected'
    ? 'ready'
    : avatarAssetRef
      ? 'invalid'
      : 'not_configured';
  return {
    status,
    backendKind: evidence.avatar.backendKind,
    avatarAssetRef,
    backgroundRef: null,
    defaultVoiceReference: null,
    avatarAutoplay: false,
    disabledReason: status === 'ready' ? null : evidence.avatar.message,
  };
}

function normalizeReadinessReasonCode(value: string): NimiRuntimeAgentExecutionReadinessReasonCode {
  if (
    value === ''
    || value === 'route_unhealthy'
    || value === 'connector_missing'
    || value === 'model_missing'
    || value === 'target_missing'
    || value === 'probe_failed'
  ) {
    return value;
  }
  return 'probe_failed';
}
