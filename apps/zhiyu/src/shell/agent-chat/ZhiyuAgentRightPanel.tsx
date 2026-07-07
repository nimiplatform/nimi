import {
  AgentCenter,
  type AgentCenterRuntimeAdapter,
  type AgentCenterRuntimeAIConfigUpsertInput,
  type AgentCenterSectionId,
  type AgentCenterStateInput,
} from '@nimiplatform/kit/features/agent-center';
import type {
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  AppCardSurface,
  IconToggleAction,
} from '@nimiplatform/kit/ui';
import { X } from 'lucide-react';
import { useMemo } from 'react';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  getZhiyuAgentAIConfig,
  getZhiyuAgentAIConfigReadiness,
  subscribeZhiyuAgentAIConfigReadiness,
  upsertZhiyuAgentAIConfig,
  type ZhiyuAgentAIConfigCallInput,
} from './agent-ai-config';
import {
  zhiyuAgentAIConfigIdentityFromRouteInput,
  zhiyuAgentAIConfigRouteInputFromEvidence,
} from '../app/agent-ai-config-route-input';
import {
  agentCenterLocalAgentRef,
  agentCenterWorldLabel,
  partnerInitial,
} from './ZhiyuAgentChatLabels';
import { useZhiyuAgentCenterAppearanceAdapter } from './zhiyu-agent-center-appearance-adapter';
import { getZhiyuRouteModelPickerProvider } from './zhiyu-route-model-picker-provider';

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
  const appearance = useZhiyuAgentCenterAppearanceAdapter(props.evidence);
  const state = useMemo<AgentCenterStateInput>(() => ({
    runtimeError: props.evidence.runtime.ready ? null : `${props.evidence.runtime.reasonCode}: ${props.evidence.runtime.message}`,
    appearance: appearance.projection,
  }), [appearance.projection, props.evidence.runtime.message, props.evidence.runtime.ready, props.evidence.runtime.reasonCode]);
  const runtimeAdapter = useMemo(
    () => buildZhiyuAgentCenterRuntimeAdapter(props.evidence),
    [props.evidence],
  );

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
            chrome="embedded"
            onSectionChange={props.onActiveTabChange}
            placementActions={{
              close: props.onClose,
              openRuntimeSettings: props.onOpenModelConfig,
              launchAvatar: props.onAvatarLaunch,
            }}
            appearanceAdapter={appearance.adapter}
            runtimeAdapter={runtimeAdapter}
            state={state}
          />
        </div>
      </AppCardSurface>
    </aside>
  );
}

function buildZhiyuAgentCenterRuntimeAdapter(evidence: ZhiyuEvidence): AgentCenterRuntimeAdapter | null {
  const routeInput = zhiyuAgentAIConfigRouteInputFromEvidence(evidence);
  const subjectUserId = routeInput.subjectUserId.trim();
  const identity = zhiyuAgentAIConfigIdentityFromRouteInput(routeInput);
  if (!subjectUserId || !identity) {
    return null;
  }
  const callInput: ZhiyuAgentAIConfigCallInput = {
    subjectUserId,
    ...identity,
  };
  const upsertWithIdentity = (input: AgentCenterRuntimeAIConfigUpsertInput) =>
    upsertZhiyuAgentAIConfig({
      ...resolveZhiyuAgentCenterMutationIdentity(callInput, input),
      subjectUserId,
      expectedRevision: input.expectedRevision,
      intents: input.intents,
    });

  return {
    agentAIConfig: {
      get(input = callInput) {
        return getZhiyuAgentAIConfig({
          ...resolveZhiyuAgentCenterCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      readiness(input = callInput) {
        return getZhiyuAgentAIConfigReadiness({
          ...resolveZhiyuAgentCenterCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      subscribeReadiness(input = callInput) {
        return subscribeZhiyuAgentAIConfigReadiness({
          ...resolveZhiyuAgentCenterCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      upsert(input) {
        return upsertZhiyuAgentAIConfig({
          ...resolveZhiyuAgentCenterCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
          expectedRevision: input.expectedRevision,
          intents: input.intents,
        });
      },
    },
    modelConfig: {
      providerResolver: getZhiyuRouteModelPickerProvider,
    },
    async loadSnapshot() {
      const [agentAIConfig, readiness] = await Promise.all([
        getZhiyuAgentAIConfig(callInput),
        getZhiyuAgentAIConfigReadiness(callInput),
      ]);
      return {
        agentAIConfig,
        readiness,
      };
    },
    upsertAgentAIConfig: upsertWithIdentity,
  };
}

function resolveZhiyuAgentCenterMutationIdentity(
  base: ZhiyuAgentAIConfigCallInput,
  input: AgentCenterRuntimeAIConfigUpsertInput,
): RuntimeLocalAgentIdentityInput {
  if (input.ownerUserId && input.runtimeSourceRef && input.localAgentRef) {
    return {
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
    };
  }
  return resolveZhiyuAgentCenterCallIdentity(base, base);
}

function resolveZhiyuAgentCenterCallIdentity(
  base: ZhiyuAgentAIConfigCallInput,
  input: Partial<RuntimeLocalAgentIdentityInput>,
): RuntimeLocalAgentIdentityInput {
  return {
    ownerUserId: input.ownerUserId || base.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef || base.runtimeSourceRef,
    localAgentRef: input.localAgentRef || base.localAgentRef,
    ...(input.scopedBinding || base.scopedBinding ? { scopedBinding: input.scopedBinding || base.scopedBinding } : {}),
  };
}
