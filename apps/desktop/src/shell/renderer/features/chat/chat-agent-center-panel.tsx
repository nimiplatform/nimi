import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { RuntimeAgentInspectSnapshot } from '@renderer/infra/runtime-agent-inspect';

type AgentCenterSectionId = 'overview' | 'appearance' | 'behavior' | 'model' | 'cognition' | 'advanced';

type AgentCenterPanelProps = {
  activeTarget: AgentLocalTargetSnapshot | null;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  routeReady: boolean;
  mutationPendingAction?: string | null;
  avatarConfigured?: boolean;
  backgroundConfigured?: boolean;
  avatarContent?: ReactNode;
  localAppearanceContent?: ReactNode;
  modelContent: ReactNode;
  cognitionContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  onEnableAutonomy?: () => void;
  onDisableAutonomy?: () => void;
  onUpdateAutonomyConfig?: (input: { mode: string; dailyTokenBudget: string; maxTokensPerHook: string }) => void;
  clearChatsTargetName?: string | null;
  clearChatsDisabled?: boolean;
  onClearAgentHistory?: () => Promise<void> | void;
};

const AUTONOMY_MODE_OPTIONS = ['off', 'low', 'medium', 'high'] as const;

function resolveToneClassName(tone?: 'ready' | 'muted' | 'attention') {
  return tone === 'ready'
    ? 'bg-emerald-50 text-emerald-700'
    : tone === 'attention'
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-600';
}

function StatusRow(props: { label: string; value: string; detail?: string | null; tone?: 'ready' | 'muted' | 'attention' }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs font-semibold text-slate-950">{props.label}</div>
        {props.detail ? (
          <div className="mt-1 text-[11px] leading-4 text-slate-500">{props.detail}</div>
        ) : null}
      </div>
      <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold', resolveToneClassName(props.tone))}>
        {props.value}
      </span>
    </div>
  );
}

function SectionBlock(props: { title: string; detail?: string | null; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white/85 px-4 py-4">
      <div className="mb-3">
        <div className="text-xs font-semibold text-slate-950">{props.title}</div>
        {props.detail ? (
          <div className="mt-1 text-[11px] leading-5 text-slate-500">{props.detail}</div>
        ) : null}
      </div>
      {props.children}
    </section>
  );
}

function DetailGrid(props: { children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">{props.children}</div>
  );
}

function DetailTile(props: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="min-h-[76px] rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{props.label}</div>
      <div className="mt-1 text-xs font-semibold text-slate-950">{props.value}</div>
      {props.detail ? (
        <div className="mt-1 text-[11px] leading-4 text-slate-500">{props.detail}</div>
      ) : null}
    </div>
  );
}

function OverviewCard(props: {
  title: string;
  value: string;
  detail: string;
  action: string;
  tone?: 'ready' | 'muted' | 'attention';
  onClick: () => void;
}) {
  const toneClassName = props.tone === 'ready'
    ? 'border-emerald-200 bg-emerald-50/70'
    : props.tone === 'attention'
      ? 'border-amber-200 bg-amber-50/70'
      : 'border-slate-200 bg-white/85';

  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn('flex min-h-[132px] flex-col rounded-lg border px-4 py-4 text-left transition-colors hover:border-slate-300 hover:bg-white', toneClassName)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-xs font-semibold text-slate-950">{props.title}</div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold', resolveToneClassName(props.tone))}>
          {props.value}
        </span>
      </div>
      <div className="mt-3 line-clamp-3 text-[11px] leading-5 text-slate-500">{props.detail}</div>
      <div className="mt-auto pt-3 text-[11px] font-semibold text-slate-700">{props.action}</div>
    </button>
  );
}

export function AgentCenterPanel(props: AgentCenterPanelProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<AgentCenterSectionId>('overview');
  const [autonomyModeDraft, setAutonomyModeDraft] = useState('off');

  const sections = useMemo<Array<{ id: AgentCenterSectionId; label: string; compactLabel?: string }>>(() => [
    { id: 'overview', label: t('Chat.agentCenterOverview', { defaultValue: 'Overview' }) },
    { id: 'appearance', label: t('Chat.agentCenterAppearance', { defaultValue: 'Appearance' }) },
    { id: 'behavior', label: t('Chat.agentCenterChatBehavior', { defaultValue: 'Chat Behavior' }), compactLabel: t('Chat.agentCenterBehaviorCompact', { defaultValue: 'Behavior' }) },
    { id: 'model', label: t('Chat.agentCenterModel', { defaultValue: 'Model' }) },
    { id: 'cognition', label: t('Chat.agentCenterCognition', { defaultValue: 'Cognition' }) },
    { id: 'advanced', label: t('Chat.agentCenterAdvanced', { defaultValue: 'Advanced' }) },
  ], [t]);

  const runtimeStatus = props.runtimeInspectLoading
    ? t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
    : props.runtimeInspect?.statusText || props.runtimeInspect?.executionState || t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' });
  const cognitionStatus = props.runtimeInspectLoading
    ? t('Chat.agentCenterChecking', { defaultValue: 'Checking' })
    : props.runtimeInspect
      ? t('Chat.agentCenterReadOnly', { defaultValue: 'Read-only' })
      : t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' });
  const behaviorStatus = props.runtimeInspect?.autonomyEnabled
    ? t('Chat.agentCenterEnabled', { defaultValue: 'On' })
    : props.runtimeInspect
      ? t('Chat.agentCenterOff', { defaultValue: 'Off' })
      : t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' });
  const modelStatus = props.routeReady
    ? t('Chat.agentCenterReady', { defaultValue: 'Ready' })
    : t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' });
  const avatarStatus = props.avatarConfigured
    ? t('Chat.agentCenterReady', { defaultValue: 'Ready' })
    : t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' });
  const avatarTone: 'ready' | 'attention' = props.avatarConfigured ? 'ready' : 'attention';
  const behaviorTone: 'ready' | 'muted' = props.runtimeInspect?.autonomyEnabled ? 'ready' : 'muted';
  const modelTone: 'ready' | 'attention' = props.routeReady ? 'ready' : 'attention';
  const cognitionTone: 'ready' | 'muted' = props.runtimeInspect ? 'ready' : 'muted';
  const worldLabel = props.activeTarget?.worldName || t('Chat.agentCenterNotProvided', { defaultValue: 'Not provided' });
  const handleLabel = props.activeTarget?.handle || t('Chat.agentCenterNotProvided', { defaultValue: 'Not provided' });
  const ownershipLabel = props.activeTarget?.ownershipType || t('Chat.agentCenterNotProvided', { defaultValue: 'Not provided' });
  const currentActivityLabel = props.runtimeInspect?.executionState || t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' });
  const currentStatusLabel = props.runtimeInspect?.statusText || t('Chat.agentCenterNotProvided', { defaultValue: 'Not provided' });
  const imageStatus = props.activeTarget?.avatarUrl
    ? t('Chat.agentCenterAvailable', { defaultValue: 'Available' })
    : t('Chat.agentCenterNotProvided', { defaultValue: 'Not provided' });
  const voiceStatus = t('Chat.agentCenterNotProvided', { defaultValue: 'Not provided' });
  const backgroundStatus = props.backgroundConfigured
    ? t('Chat.agentCenterReady', { defaultValue: 'Ready' })
    : t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' });
  const pendingHooksStatus = props.runtimeInspect
    ? String(props.runtimeInspect.pendingHooksCount)
    : t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' });
  const autonomyModeStatus = props.runtimeInspect?.autonomyMode
    ? props.runtimeInspect.autonomyMode
    : props.runtimeInspect
      ? t('Chat.agentCenterOff', { defaultValue: 'Off' })
      : t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' });
  const committedAutonomyMode = props.runtimeInspect?.autonomyMode || 'off';
  const autonomyModeDirty = props.runtimeInspect ? autonomyModeDraft !== committedAutonomyMode : false;
  const autonomyPending = Boolean(props.mutationPendingAction?.toLowerCase().includes('autonomy'));
  const autonomyUnavailableReason = !props.runtimeInspect
    ? t('Chat.agentCenterBehaviorUnavailableReason', { defaultValue: 'Agent service status is unavailable.' })
    : autonomyModeDirty
      ? t('Chat.agentCenterBehaviorModeDirty', { defaultValue: 'Apply the behavior mode before enabling.' })
      : props.runtimeInspect.autonomyEnabled !== true && props.runtimeInspect.autonomyMode === 'off'
        ? t('Chat.agentCenterBehaviorModeRequired', { defaultValue: 'Choose and apply a non-off mode before enabling.' })
        : null;
  const autonomyConfigDisabled = autonomyPending
    || !props.runtimeInspect
    || !props.onUpdateAutonomyConfig;
  const autonomyConfigActionDisabled = autonomyConfigDisabled || !autonomyModeDirty;
  const applyAutonomyConfig = useCallback(() => {
    if (!props.runtimeInspect || !props.onUpdateAutonomyConfig) {
      return;
    }
    props.onUpdateAutonomyConfig({
      mode: autonomyModeDraft,
      dailyTokenBudget: String(props.runtimeInspect.autonomyDailyTokenBudget ?? 0),
      maxTokensPerHook: String(props.runtimeInspect.autonomyMaxTokensPerHook ?? 0),
    });
  }, [autonomyModeDraft, props]);
  const modeLabels = useMemo<Record<string, string>>(() => ({
    off: t('Chat.agentCenterBehaviorModeOff', { defaultValue: 'Off' }),
    low: t('Chat.agentCenterBehaviorModeLow', { defaultValue: 'Low' }),
    medium: t('Chat.agentCenterBehaviorModeMedium', { defaultValue: 'Balanced' }),
    high: t('Chat.agentCenterBehaviorModeHigh', { defaultValue: 'Active' }),
  }), [t]);
  useEffect(() => {
    setAutonomyModeDraft(committedAutonomyMode);
  }, [committedAutonomyMode]);

  const autonomyActionDisabled = autonomyPending
    || !props.runtimeInspect
    || autonomyModeDirty
    || (props.runtimeInspect.autonomyEnabled === true ? !props.onDisableAutonomy : !props.onEnableAutonomy)
    || (props.runtimeInspect.autonomyEnabled !== true && props.runtimeInspect.autonomyMode === 'off');

  const handleClearHistory = useCallback(() => {
    if (!props.onClearAgentHistory) {
      return;
    }
    void (async () => {
      const confirmation = await confirmDialog({
        title: t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' }),
        description: t('Chat.clearAgentChatHistoryConfirm', {
          defaultValue: 'Clear messages shown on this device for {{name}}? This does not delete agent memory or cognition.',
          name: props.clearChatsTargetName || props.activeTarget?.displayName || '',
        }),
        level: 'warning',
      });
      if (!confirmation.confirmed) {
        return;
      }
      await props.onClearAgentHistory?.();
    })().catch(() => {
      // Upstream host error handling owns action failures.
    });
  }, [props, t]);

  const overview = (
    <div className="space-y-4">
      <SectionBlock
        title={t('Chat.agentCenterAgentSnapshot', { defaultValue: 'Agent snapshot' })}
        detail={t('Chat.agentCenterAgentSnapshotHint', { defaultValue: 'Identity and state are read-only here.' })}
      >
        <div className="text-sm font-semibold text-slate-950">
          {props.activeTarget?.displayName || t('Chat.agentGenericIdentity', { defaultValue: 'Agent' })}
        </div>
        <div className="mt-1 text-xs leading-5 text-slate-500">
          {props.activeTarget?.bio || props.activeTarget?.worldName || t('Chat.agentCenterReadOnlyDetails', { defaultValue: 'Read-only identity and status.' })}
        </div>
        <div className="mt-4">
          <DetailGrid>
            <DetailTile label={t('Chat.agentCenterHandle', { defaultValue: 'Handle' })} value={handleLabel} />
            <DetailTile label={t('Chat.agentCenterWorld', { defaultValue: 'World' })} value={worldLabel} />
            <DetailTile label={t('Chat.agentCenterReferenceImage', { defaultValue: 'Reference image' })} value={imageStatus} />
            <DetailTile label={t('Chat.agentCenterReferenceVoice', { defaultValue: 'Reference voice' })} value={voiceStatus} />
          </DetailGrid>
        </div>
      </SectionBlock>
      <div className="grid gap-3 sm:grid-cols-2">
        <OverviewCard
          title={t('Chat.agentCenterAvatarStatus', { defaultValue: 'Avatar' })}
          value={avatarStatus}
          tone={avatarTone}
          detail={props.avatarConfigured
            ? t('Chat.agentCenterAvatarReadyHint', { defaultValue: 'Avatar setup is present. Launch controls stay in the composer.' })
            : t('Chat.agentCenterAvatarStatusHint', { defaultValue: 'Start and stop belongs in the composer. Setup lives in Appearance.' })}
          action={t('Chat.agentCenterGoAppearance', { defaultValue: 'Open Appearance' })}
          onClick={() => setActiveSection('appearance')}
        />
        <OverviewCard
          title={t('Chat.agentCenterBehaviorStatus', { defaultValue: 'Chat Behavior' })}
          value={behaviorStatus}
          tone={behaviorTone}
          detail={t('Chat.agentCenterBehaviorScope', { defaultValue: 'Managed by Agent service.' })}
          action={t('Chat.agentCenterGoBehavior', { defaultValue: 'Manage behavior' })}
          onClick={() => setActiveSection('behavior')}
        />
        <OverviewCard
          title={t('Chat.agentCenterModelStatus', { defaultValue: 'Model' })}
          value={modelStatus}
          tone={modelTone}
          detail={t('Chat.agentCenterModelScope', { defaultValue: 'Uses the shared model configuration.' })}
          action={t('Chat.agentCenterGoModel', { defaultValue: 'Configure model' })}
          onClick={() => setActiveSection('model')}
        />
        <OverviewCard
          title={t('Chat.agentCenterCognitionStatus', { defaultValue: 'Cognition' })}
          value={cognitionStatus}
          tone={cognitionTone}
          detail={t('Chat.agentCenterCognitionScope', { defaultValue: 'Read-only status from Agent service.' })}
          action={t('Chat.agentCenterGoCognition', { defaultValue: 'View cognition' })}
          onClick={() => setActiveSection('cognition')}
        />
      </div>
      <section className="rounded-lg border border-slate-200 bg-white/85 px-4">
        <StatusRow label={t('Chat.agentCenterCurrentState', { defaultValue: 'Current state' })} value={runtimeStatus} tone={props.runtimeInspect ? 'ready' : 'muted'} />
        <StatusRow label={t('Chat.agentCenterPendingActions', { defaultValue: 'Pending actions' })} value={pendingHooksStatus} tone={props.runtimeInspect?.pendingHooksCount ? 'attention' : props.runtimeInspect ? 'ready' : 'muted'} />
      </section>
    </div>
  );

  const appearance = (
    <div className="space-y-4">
      <SectionBlock
        title={t('Chat.agentCenterAppearanceSetup', { defaultValue: 'Avatar setup' })}
        detail={t('Chat.agentCenterAppearanceSetupHint', { defaultValue: 'Choose local visual assets and check whether the avatar can launch.' })}
      >
        {props.avatarContent || (
          <StatusRow label={t('Chat.agentCenterAvatarStatus', { defaultValue: 'Avatar' })} value={t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' })} />
        )}
      </SectionBlock>
      <SectionBlock
        title={t('Chat.agentCenterLocalAppearance', { defaultValue: 'Local appearance' })}
        detail={t('Chat.agentCenterLocalAppearanceHint', { defaultValue: 'Stored on this device for this agent.' })}
      >
        {props.localAppearanceContent || (
          <StatusRow label={t('Chat.agentCenterBackground', { defaultValue: 'Background' })} value={backgroundStatus} tone={props.backgroundConfigured ? 'ready' : 'muted'} detail={t('Chat.agentCenterBackgroundScope', { defaultValue: 'Background for this agent on this device.' })} />
        )}
        <StatusRow label={t('Chat.agentCenterMotion', { defaultValue: 'Motion' })} value={t('Chat.agentCenterOff', { defaultValue: 'Off' })} tone="muted" detail={t('Chat.agentCenterMotionHint', { defaultValue: 'Local motion preferences should respect reduced motion.' })} />
      </SectionBlock>
    </div>
  );

  const behavior = (
    <div className="space-y-4">
      <SectionBlock
        title={t('Chat.agentCenterAutonomyTitle', { defaultValue: 'Agent-initiated behavior' })}
        detail={t('Chat.agentCenterAutonomyHint', { defaultValue: 'These controls are available only when Agent service exposes them.' })}
      >
        <StatusRow label={t('Chat.agentCenterProactive', { defaultValue: 'Proactive communication' })} value={behaviorStatus} tone={props.runtimeInspect?.autonomyEnabled ? 'ready' : 'muted'} detail={t('Chat.agentCenterRuntimeControlled', { defaultValue: 'Managed by Agent service.' })} />
        <StatusRow label={t('Chat.agentCenterContinuousActions', { defaultValue: 'Continuous actions' })} value={behaviorStatus} tone={props.runtimeInspect?.autonomyEnabled ? 'ready' : 'muted'} detail={t('Chat.agentCenterRuntimeControlled', { defaultValue: 'Managed by Agent service.' })} />
        <StatusRow label={t('Chat.agentCenterAutonomyMode', { defaultValue: 'Mode' })} value={autonomyModeStatus} tone={props.runtimeInspect?.autonomyEnabled ? 'ready' : 'muted'} />
        <StatusRow label={t('Chat.agentCenterPendingActions', { defaultValue: 'Pending actions' })} value={pendingHooksStatus} tone={props.runtimeInspect?.pendingHooksCount ? 'attention' : props.runtimeInspect ? 'ready' : 'muted'} />
        <div className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_auto]">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            {t('Chat.agentCenterBehaviorModeLabel', { defaultValue: 'Behavior mode' })}
            <select
              value={autonomyModeDraft}
              disabled={autonomyConfigDisabled}
              onChange={(event) => setAutonomyModeDraft(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold normal-case tracking-normal text-slate-800 outline-none transition focus:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {AUTONOMY_MODE_OPTIONS.map((mode) => (
                <option key={mode} value={mode}>
                  {modeLabels[mode]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={autonomyConfigActionDisabled}
            onClick={applyAutonomyConfig}
            className="self-end rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('Chat.agentCenterApplyBehaviorMode', { defaultValue: 'Apply mode' })}
          </button>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <button
            type="button"
            disabled={autonomyActionDisabled}
            onClick={props.runtimeInspect?.autonomyEnabled === true ? props.onDisableAutonomy : props.onEnableAutonomy}
            className="inline-flex rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {autonomyPending
              ? t('Chat.agentCenterBehaviorUpdating', { defaultValue: 'Updating...' })
              : props.runtimeInspect?.autonomyEnabled === true
                ? t('Chat.agentCenterDisableAutonomy', { defaultValue: 'Pause proactive behavior' })
                : t('Chat.agentCenterEnableAutonomy', { defaultValue: 'Enable proactive behavior' })}
          </button>
          {autonomyUnavailableReason ? (
            <div className="mt-2 text-[11px] leading-4 text-slate-500">{autonomyUnavailableReason}</div>
          ) : null}
        </div>
      </SectionBlock>
      <SectionBlock
        title={t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' })}
        detail={t('Chat.agentCenterClearHistoryScope', { defaultValue: 'Clears messages shown on this device.' })}
      >
        <button
          type="button"
          disabled={props.clearChatsDisabled || !props.onClearAgentHistory}
          onClick={handleClearHistory}
          className="mt-3 inline-flex rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50"
        >
          {t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' })}
        </button>
      </SectionBlock>
    </div>
  );

  const cognition = (
    <div className="space-y-4">
      <SectionBlock
        title={t('Chat.agentCenterAgentDetails', { defaultValue: 'Agent details' })}
        detail={t('Chat.agentCenterReadOnlyDetails', { defaultValue: 'Read-only identity and status.' })}
      >
        <DetailGrid>
          <DetailTile label={t('Chat.agentCenterPersonality', { defaultValue: 'Personality' })} value={props.activeTarget?.bio || t('Chat.agentCenterNotProvided', { defaultValue: 'Not provided' })} />
          <DetailTile label={t('Chat.agentCenterWorldview', { defaultValue: 'Worldview' })} value={worldLabel} />
          <DetailTile label={t('Chat.agentCenterOwnership', { defaultValue: 'Ownership' })} value={ownershipLabel} />
          <DetailTile label={t('Chat.agentCenterActivity', { defaultValue: 'Activity' })} value={currentActivityLabel} />
          <DetailTile label={t('Chat.agentCenterStatusText', { defaultValue: 'Status note' })} value={currentStatusLabel} />
          <DetailTile label={t('Chat.agentCenterReferenceImage', { defaultValue: 'Reference image' })} value={imageStatus} />
          <DetailTile label={t('Chat.agentCenterReferenceVoice', { defaultValue: 'Reference voice' })} value={voiceStatus} />
        </DetailGrid>
        <div className="mt-3 border-t border-slate-100">
          <StatusRow label={t('Chat.agentCenterCurrentState', { defaultValue: 'Current state' })} value={runtimeStatus} tone={props.runtimeInspect ? 'ready' : 'muted'} />
        </div>
      </SectionBlock>
      <SectionBlock
        title={t('Chat.agentCenterCognitionTitle', { defaultValue: 'Cognition status' })}
        detail={t('Chat.agentCenterCognitionV1Hint', { defaultValue: 'V1 shows status only unless Agent service exposes a control.' })}
      >
        <StatusRow label={t('Chat.agentCenterCognitionStatus', { defaultValue: 'Cognition' })} value={cognitionStatus} tone={props.runtimeInspect ? 'ready' : 'muted'} detail={t('Chat.agentCenterCognitionScope', { defaultValue: 'Read-only status from Agent service.' })} />
      </SectionBlock>
      {props.cognitionContent}
    </div>
  );

  const model = (
    <div className="space-y-4">
      <SectionBlock
        title={t('Chat.agentCenterModelRoute', { defaultValue: 'Model route' })}
        detail={t('Chat.agentCenterModelScope', { defaultValue: 'Uses the shared model configuration.' })}
      >
        <StatusRow label={t('Chat.agentCenterModelStatus', { defaultValue: 'Model' })} value={modelStatus} tone={modelTone} />
      </SectionBlock>
      {props.modelContent}
    </div>
  );

  const advanced = (
    <details className="rounded-lg border border-slate-200 bg-white/85 px-4 py-4">
      <summary className="cursor-pointer text-xs font-semibold text-slate-950">
        {t('Chat.agentCenterAdvancedDiagnostics', { defaultValue: 'Diagnostics' })}
      </summary>
      <div className="mt-4">
        {props.diagnosticsContent || (
          <div className="text-xs text-slate-500">
            {t('Chat.agentCenterDiagnosticsUnavailable', { defaultValue: 'Diagnostics unavailable.' })}
          </div>
        )}
      </div>
    </details>
  );

  const contentBySection: Record<AgentCenterSectionId, ReactNode> = {
    overview,
    appearance,
    behavior,
    model,
    cognition,
    advanced,
  };

  const active = sections.find((section) => section.id === activeSection) || sections[0]!;

  return (
    <div className="min-h-0" data-chat-agent-center="true">
      <div className="flex min-h-0 flex-col gap-3 xl:flex-row">
        <nav
          aria-label={t('Chat.agentCenterNavigation', { defaultValue: 'Agent Center sections' })}
          className="flex gap-2 overflow-x-auto pb-1 xl:w-36 xl:shrink-0 xl:flex-col xl:overflow-visible xl:pb-0"
        >
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              aria-current={section.id === activeSection ? 'page' : undefined}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                'shrink-0 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors',
                section.id === activeSection
                  ? 'bg-slate-950 text-white'
                  : 'bg-white/85 text-slate-600 hover:bg-slate-100 hover:text-slate-950',
              )}
            >
              <span className="hidden sm:inline xl:hidden 2xl:inline">{section.label}</span>
              <span className="sm:hidden xl:inline 2xl:hidden">{section.compactLabel || section.label}</span>
            </button>
          ))}
        </nav>
        <section className="min-w-0 flex-1" aria-label={active.label}>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-950">{active.label}</h3>
          </div>
          {contentBySection[active.id]}
        </section>
      </div>
    </div>
  );
}
