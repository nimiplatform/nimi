import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@nimiplatform/kit/ui';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { NimiRuntimeAgentInspectSnapshot } from '@renderer/infra/runtime-agent-inspect';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  Btn,
  Card,
  ChecklistItem,
  Group,
  GroupHead,
  Kv,
  KvGrid,
  ModePicker,
  ProactiveToggleRow,
  ProgressHero,
  Row,
  SECTION_ICONS,
  StateRow,
  StatusPill,
  WarnBanner,
  attentionPillTone,
  type AgentCenterSectionId,
} from './chat-agent-center-panel-components';

export { AdvBlock } from './chat-agent-center-panel-components';

type AgentCenterPanelProps = {
  activeTarget: AgentLocalTargetSnapshot | null;
  runtimeInspect: NimiRuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  routeReady: boolean;
  mutationPendingAction?: string | null;
  avatarConfigured?: boolean;
  backgroundConfigured?: boolean;
  avatarAutoplay?: boolean;
  voicePolicyPending?: boolean;
  voicePolicyError?: string | null;
  voiceCleanupPending?: boolean;
  voiceCleanupError?: string | null;
  avatarContent?: ReactNode;
  localAppearanceContent?: ReactNode;
  modelContent: ReactNode;
  cognitionContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  onEnableAutonomy?: () => void;
  onDisableAutonomy?: () => void;
  onAvatarAutoplayChange?: (enabled: boolean) => void;
  onCleanupGeneratedVoiceArtifacts?: () => void;
  onUpdateAutonomyConfig?: (input: { mode: string; dailyTokenBudget: string; maxTokensPerHook: string }) => void;
};
// ── Main component ────────────────────────────────────────────────────────

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

  // ── Derived status text ─────────────────────────────────────────────────
  const checking = t('Chat.agentCenterChecking', { defaultValue: 'Checking' });
  const unavailable = t('Chat.agentCenterUnavailable', { defaultValue: 'Unavailable' });
  const ready = t('Chat.agentCenterReady', { defaultValue: 'Ready' });
  const needsSetup = t('Chat.agentCenterNeedsSetup', { defaultValue: 'Needs setup' });
  const onLabel = t('Chat.agentCenterEnabled', { defaultValue: 'On' });
  const offLabel = t('Chat.agentCenterOff', { defaultValue: 'Off' });
  const notProvided = t('Chat.agentCenterNotProvided', { defaultValue: 'Not provided' });
  const readOnly = t('Chat.agentCenterReadOnly', { defaultValue: 'Read-only' });

  const runtimeStatus = props.runtimeInspectLoading
    ? checking
    : props.runtimeInspect?.statusText || props.runtimeInspect?.executionState || unavailable;
  const cognitionStatus = props.runtimeInspectLoading
    ? checking
    : props.runtimeInspect ? readOnly : unavailable;
  const behaviorStatus = props.runtimeInspect?.autonomyEnabled ? onLabel : props.runtimeInspect ? offLabel : unavailable;
  const avatarAutoplayStatus = props.avatarAutoplay ? onLabel : offLabel;
  const modelStatus = props.routeReady ? ready : needsSetup;
  const avatarStatus = props.avatarConfigured ? ready : needsSetup;
  const backgroundStatus = props.backgroundConfigured ? ready : needsSetup;

  const avatarTone: 'ready' | 'attention' = props.avatarConfigured ? 'ready' : 'attention';
  const behaviorTone: 'ready' | 'muted' = props.runtimeInspect?.autonomyEnabled ? 'ready' : 'muted';
  const modelTone: 'ready' | 'attention' = props.routeReady ? 'ready' : 'attention';
  const cognitionTone: 'ready' | 'muted' | 'checking' = props.runtimeInspectLoading
    ? 'muted'
    : props.runtimeInspect ? 'ready' : 'muted';

  const worldLabel = props.activeTarget?.worldName || notProvided;
  const ownershipLabel = props.activeTarget?.ownershipType || notProvided;
  const currentActivityLabel = props.runtimeInspect?.executionState || unavailable;
  const currentStatusLabel = props.runtimeInspect?.statusText || notProvided;
  const imageStatus = props.activeTarget?.avatarUrl
    ? t('Chat.agentCenterAvailable', { defaultValue: 'Available' })
    : notProvided;
  const voiceStatus = notProvided;
  const pendingHooksStatus = props.runtimeInspect ? String(props.runtimeInspect.pendingHooksCount) : unavailable;
  const autonomyModeStatus = props.runtimeInspect?.autonomyMode
    ? props.runtimeInspect.autonomyMode
    : props.runtimeInspect ? offLabel : unavailable;

  const committedAutonomyMode = props.runtimeInspect?.autonomyMode || 'off';
  const autonomyModeDirty = props.runtimeInspect ? autonomyModeDraft !== committedAutonomyMode : false;
  const autonomyPending = Boolean(props.mutationPendingAction?.toLowerCase().includes('autonomy'));
  const autonomyConfigDisabled = autonomyPending || !props.runtimeInspect || !props.onUpdateAutonomyConfig;
  const modeLabels = useMemo(() => ({
    off: { title: t('Chat.agentCenterBehaviorModeOff', { defaultValue: 'Off' }), sub: t('Chat.agentCenterBehaviorModeOffSub', { defaultValue: 'Silent' }) },
    low: { title: t('Chat.agentCenterBehaviorModeLow', { defaultValue: 'Low' }), sub: t('Chat.agentCenterBehaviorModeLowSub', { defaultValue: 'Rare' }) },
    medium: { title: t('Chat.agentCenterBehaviorModeMedium', { defaultValue: 'Balanced' }), sub: t('Chat.agentCenterBehaviorModeMediumSub', { defaultValue: 'Daily' }) },
    high: { title: t('Chat.agentCenterBehaviorModeHigh', { defaultValue: 'Active' }), sub: t('Chat.agentCenterBehaviorModeHighSub', { defaultValue: 'Hourly' }) },
  }), [t]);
  // Reset draft to runtime truth whenever the upstream commit changes (covers
  // both successful applies and silent reverts when a runtime mutation fails).
  useEffect(() => {
    setAutonomyModeDraft(committedAutonomyMode);
  }, [committedAutonomyMode]);

  // Auto-save mode draft after a 350ms idle window. Local UI feedback is
  // immediate; the runtime mutation is debounced so rapid clicking through
  // modes coalesces to a single commit. If the commit fails, the effect
  // above syncs the draft back to the runtime's last-known mode.
  const onUpdateAutonomyConfigRef = useRef(props.onUpdateAutonomyConfig);
  const runtimeInspectRef = useRef(props.runtimeInspect);
  onUpdateAutonomyConfigRef.current = props.onUpdateAutonomyConfig;
  runtimeInspectRef.current = props.runtimeInspect;
  useEffect(() => {
    if (autonomyConfigDisabled || !autonomyModeDirty) {
      return undefined;
    }
    const timer = setTimeout(() => {
      const inspect = runtimeInspectRef.current;
      const update = onUpdateAutonomyConfigRef.current;
      if (!inspect || !update) {
        return;
      }
      update({
        mode: autonomyModeDraft,
        dailyTokenBudget: String(inspect.autonomyDailyTokenBudget ?? 0),
        maxTokensPerHook: String(inspect.autonomyMaxTokensPerHook ?? 0),
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [autonomyModeDraft, autonomyConfigDisabled, autonomyModeDirty]);

  const autonomyEnabled = props.runtimeInspect?.autonomyEnabled === true;
  // Toggle is disabled when (a) runtime is unavailable, (b) a mutation is in flight,
  // (c) the corresponding handler is missing, or (d) the user is trying to enable
  // while the committed mode is still 'off'. The autonomyModeDirty case is no
  // longer a blocker — the debounce will commit shortly and the state updates
  // before the user can interact further.
  const toggleHandlerMissing = autonomyEnabled ? !props.onDisableAutonomy : !props.onEnableAutonomy;
  const toggleNeedsNonOffMode = !autonomyEnabled && committedAutonomyMode === 'off';
  const autonomyActionDisabled = autonomyPending
    || !props.runtimeInspect
    || toggleHandlerMissing
    || toggleNeedsNonOffMode
    || autonomyModeDirty;
  // Tooltip only appears when the toggle is disabled for a user-fixable reason —
  // we surface the most actionable hint first.
  const autonomyDisabledHint = !props.runtimeInspect
    ? t('Chat.agentCenterBehaviorUnavailableReason', { defaultValue: 'Agent service status is unavailable.' })
    : toggleNeedsNonOffMode
      ? t('Chat.agentCenterBehaviorModeRequired', { defaultValue: 'Choose a non-off mode before enabling.' })
      : autonomyModeDirty
        ? t('Chat.agentCenterBehaviorModeSaving', { defaultValue: 'Saving mode change…' })
        : null;
  const avatarAutoplayDisabled = Boolean(props.voicePolicyPending) || !props.onAvatarAutoplayChange;
  const avatarAutoplayDisabledHint = !props.onAvatarAutoplayChange
    ? t('Chat.agentCenterVoicePolicyUnavailableReason', { defaultValue: 'Agent voice playback policy is unavailable.' })
    : null;
  const voiceCleanupDisabled = Boolean(props.voiceCleanupPending) || !props.onCleanupGeneratedVoiceArtifacts;

  // ── Setup score (Avatar / Background / Model / Behavior / Cognition) ──
  const setupTotal = 5;
  const setupDone = (props.avatarConfigured ? 1 : 0)
    + (props.backgroundConfigured ? 1 : 0)
    + (props.routeReady ? 1 : 0)
    + (props.runtimeInspect?.autonomyEnabled ? 1 : 0)
    + (props.runtimeInspect ? 1 : 0);
  const remaining = setupTotal - setupDone;
  const heroTitle = remaining === 0
    ? t('Chat.agentCenterHeroAllReady', { defaultValue: 'Ready to chat' })
    : t('Chat.agentCenterHeroAlmostReady', { defaultValue: 'Almost ready to chat' });
  const heroDesc = remaining === 0
    ? t('Chat.agentCenterHeroAllReadyDesc', { defaultValue: 'Setup is complete. You can speak with this agent now.' })
    : t('Chat.agentCenterHeroRemainingDesc', { defaultValue: '{{count}} item still needs your attention.', count: remaining });
  const heroNextCta = !props.avatarConfigured
    ? t('Chat.agentCenterHeroContinueAvatar', { defaultValue: 'Continue with Avatar' })
    : !props.routeReady
      ? t('Chat.agentCenterGoModel', { defaultValue: 'Configure model' })
      : !props.backgroundConfigured
        ? t('Chat.agentCenterGoAppearance', { defaultValue: 'Open Appearance' })
        : null;
  const heroNextTarget: AgentCenterSectionId | null = !props.avatarConfigured
    ? 'appearance'
    : !props.routeReady
      ? 'model'
      : !props.backgroundConfigured
        ? 'appearance'
        : null;

  // ── Tab content: Overview ─────────────────────────────────────────────
  const overview = (
    <div>
      <ProgressHero
        setupDone={setupDone}
        setupTotal={setupTotal}
        title={heroTitle}
        description={heroDesc}
        setupLabel={t('Chat.agentCenterHeroSetupLabel', { defaultValue: 'Setup' })}
        nextCta={heroNextCta || undefined}
        onNext={heroNextTarget ? () => setActiveSection(heroNextTarget) : undefined}
      />

      <Group>
        <GroupHead title={t('Chat.agentCenterSetupChecklist', { defaultValue: 'Setup checklist' })} />
        <Card>
          <ChecklistItem
            index={1}
            status={props.avatarConfigured ? 'done' : 'attn'}
            title={t('Chat.agentCenterAvatarStatus', { defaultValue: 'Avatar' })}
            description={props.avatarConfigured
              ? undefined
              : t('Chat.agentCenterAvatarStatusHint', { defaultValue: 'Setup lives in Appearance.' })}
            pill={{ tone: attentionPillTone(avatarTone), label: avatarStatus }}
            onClick={() => setActiveSection('appearance')}
          />
          <ChecklistItem
            index={2}
            status={props.routeReady ? 'done' : 'todo'}
            title={t('Chat.agentCenterModelStatus', { defaultValue: 'Model' })}
            pill={{ tone: attentionPillTone(modelTone), label: modelStatus }}
            onClick={() => setActiveSection('model')}
          />
          <ChecklistItem
            index={3}
            status={props.runtimeInspect?.autonomyEnabled ? 'done' : 'todo'}
            title={t('Chat.agentCenterBehaviorStatus', { defaultValue: 'Chat Behavior' })}
            pill={{ tone: behaviorTone === 'ready' ? 'ready' : 'muted', label: behaviorStatus }}
            onClick={() => setActiveSection('behavior')}
          />
          <ChecklistItem
            index={4}
            status={props.runtimeInspect ? 'done' : 'todo'}
            title={t('Chat.agentCenterCognitionStatus', { defaultValue: 'Cognition' })}
            pill={{ tone: props.runtimeInspectLoading ? 'checking' : (cognitionTone === 'ready' ? 'ready' : 'muted'), label: cognitionStatus }}
            onClick={() => setActiveSection('cognition')}
          />
        </Card>
      </Group>

      <Group>
        <GroupHead title={t('Chat.agentCenterLiveState', { defaultValue: 'Live state' })} />
        <Card>
          <StateRow
            label={t('Chat.agentCenterCurrentState', { defaultValue: 'Current state' })}
            right={<StatusPill tone={props.runtimeInspectLoading ? 'checking' : (props.runtimeInspect ? 'ready' : 'muted')} label={runtimeStatus} />}
          />
          <StateRow
            label={t('Chat.agentCenterPendingActions', { defaultValue: 'Pending actions' })}
            value={pendingHooksStatus}
            valueTone={props.runtimeInspect?.pendingHooksCount ? 'attn' : 'plain'}
          />
          <StateRow
            label={t('Chat.agentCenterActivity', { defaultValue: 'Activity' })}
            value={currentActivityLabel}
          />
          <StateRow
            label={t('Chat.agentCenterOwnership', { defaultValue: 'Ownership' })}
            right={<span className="font-mono text-[11px] font-semibold text-slate-900">{ownershipLabel}</span>}
          />
        </Card>
      </Group>
    </div>
  );

  // ── Tab content: Appearance ───────────────────────────────────────────
  const appearance = (
    <div>
      <Group>
        <GroupHead
          title={t('Chat.agentCenterAppearanceSetup', { defaultValue: 'Avatar setup' })}
          right={<StatusPill tone={attentionPillTone(avatarTone)} label={avatarStatus} />}
        />
        {props.avatarContent || (
          <Card>
            <StateRow label={t('Chat.agentCenterAvatarStatus', { defaultValue: 'Avatar' })} right={<StatusPill tone="muted" label={unavailable} />} />
          </Card>
        )}
      </Group>

      <Group>
        <GroupHead
          title={t('Chat.agentCenterBackground', { defaultValue: 'Background' })}
          right={<StatusPill tone={props.backgroundConfigured ? 'ready' : 'warn'} label={backgroundStatus} />}
        />
        {props.localAppearanceContent || (
          <Card>
            <StateRow label={t('Chat.agentCenterBackground', { defaultValue: 'Background' })} right={<StatusPill tone="muted" label={backgroundStatus} />} />
          </Card>
        )}
      </Group>

      <Group>
        <GroupHead title={t('Chat.agentCenterMotion', { defaultValue: 'Motion' })} />
        <Card>
          <Row
            label={t('Chat.agentCenterMotionTitle', { defaultValue: 'Reduce motion' })}
            right={<StatusPill tone="muted" label={offLabel} />}
          />
        </Card>
      </Group>
    </div>
  );

  // ── Tab content: Behavior ─────────────────────────────────────────────
  const behavior = (
    <div>
      <Group>
        <GroupHead
          title={t('Chat.agentCenterBehaviorModeLabel', { defaultValue: 'Behavior mode' })}
          right={<StatusPill tone={behaviorTone === 'ready' ? 'ready' : 'muted'} label={autonomyModeStatus} />}
        />
        <Card>
          {/* Mode change auto-saves with a 350ms debounce — no explicit Apply button. */}
          <ModePicker
            value={autonomyModeDraft}
            onChange={setAutonomyModeDraft}
            disabled={autonomyConfigDisabled}
            labels={modeLabels}
          />
          <ProactiveToggleRow
            checked={autonomyEnabled}
            disabled={autonomyActionDisabled}
            disabledHint={autonomyDisabledHint}
            pending={autonomyPending}
            onChange={(next) => {
              if (next) {
                props.onEnableAutonomy?.();
              } else {
                props.onDisableAutonomy?.();
              }
            }}
            label={t('Chat.agentCenterProactiveLabel', { defaultValue: 'Proactive behavior' })}
            description={autonomyEnabled
              ? t('Chat.agentCenterProactiveOnDesc', { defaultValue: 'Agent reaches out on its own.' })
              : t('Chat.agentCenterProactiveOffDesc', { defaultValue: 'Agent only replies when spoken to.' })}
            updatingLabel={t('Chat.agentCenterBehaviorUpdating', { defaultValue: 'Updating…' })}
          />
          <ProactiveToggleRow
            checked={props.avatarAutoplay === true}
            disabled={avatarAutoplayDisabled}
            disabledHint={avatarAutoplayDisabledHint}
            pending={props.voicePolicyPending === true}
            onChange={(next) => props.onAvatarAutoplayChange?.(next)}
            label={t('Chat.agentCenterAvatarAutoplayLabel', { defaultValue: 'Avatar voice autoplay' })}
            description={props.voicePolicyError
              ? props.voicePolicyError
              : t('Chat.agentCenterAvatarAutoplayDesc', { defaultValue: 'Avatar may play Runtime voice responses automatically.' })}
            updatingLabel={t('Chat.agentCenterVoicePolicyUpdating', { defaultValue: 'Updating…' })}
          />
          <Row
            label={t('Chat.agentCenterVoiceCleanupLabel', { defaultValue: 'Generated voice cache' })}
            desc={props.voiceCleanupError
              ? props.voiceCleanupError
              : t('Chat.agentCenterVoiceCleanupDesc', { defaultValue: 'Clear generated voice artifacts for this conversation.' })}
            right={(
              <Btn
                size="sm"
                variant="danger"
                disabled={voiceCleanupDisabled}
                onClick={props.onCleanupGeneratedVoiceArtifacts}
              >
                {props.voiceCleanupPending
                  ? t('Chat.agentCenterVoiceCleanupPending', { defaultValue: 'Clearing' })
                  : t('Chat.agentCenterVoiceCleanupAction', { defaultValue: 'Clear' })}
              </Btn>
            )}
          />
        </Card>
      </Group>

      <Group>
        <GroupHead
          title={t('Chat.agentCenterServiceManaged', { defaultValue: 'Service-managed' })}
          right={<span className="text-[11px] text-slate-500">{readOnly}</span>}
        />
        <Card>
          <Row
            label={t('Chat.agentCenterProactive', { defaultValue: 'Proactive communication' })}
            right={<StatusPill tone={behaviorTone === 'ready' ? 'ready' : 'muted'} label={behaviorStatus} />}
          />
          <Row
            label={t('Chat.agentCenterContinuousActions', { defaultValue: 'Continuous actions' })}
            right={<StatusPill tone={behaviorTone === 'ready' ? 'ready' : 'muted'} label={behaviorStatus} />}
          />
          <Row
            label={t('Chat.agentCenterPendingActions', { defaultValue: 'Pending actions' })}
            desc={t('Chat.agentCenterPendingActionsHint', { defaultValue: 'Queued for the next turn.' })}
            right={<span className="text-[13px] font-semibold text-slate-900">{pendingHooksStatus}</span>}
          />
          <Row
            label={t('Chat.agentCenterAvatarAutoplayLabel', { defaultValue: 'Avatar voice autoplay' })}
            right={<StatusPill tone={props.avatarAutoplay ? 'ready' : 'muted'} label={avatarAutoplayStatus} />}
          />
        </Card>
      </Group>

    </div>
  );

  // ── Tab content: Model ───────────────────────────────────────────────
  const model = (
    <div>
      <Group>
        <GroupHead
          title={t('Chat.agentCenterModelRoute', { defaultValue: 'Model route' })}
          right={<StatusPill tone={modelTone === 'ready' ? 'ready' : 'warn'} label={modelStatus} />}
        />
        <Card>
          <Row
            label={t('Chat.agentCenterSharedModelConfig', { defaultValue: 'Shared model configuration' })}
            desc={t('Chat.agentCenterSharedModelConfigDesc', { defaultValue: "This agent uses the workspace's default routing." })}
            right={(
              <Btn size="sm" variant="default" onClick={() => dispatchRuntimeConfigOpenPage('models')}>
                {t('Chat.agentCenterModelOverride', { defaultValue: 'Override' })}
              </Btn>
            )}
          />
        </Card>
      </Group>
      {props.modelContent ? (
        <Group>
          {/* The shared ModelConfigAiModelHub renders its own header (title + aggregate status + Import AI Profile)
              and—when superSections are provided—the grouped 2-column capability grid. */}
          <div className="rounded-[14px] border border-slate-200/90 bg-white p-4">
            {props.modelContent}
          </div>
        </Group>
      ) : null}
    </div>
  );

  // ── Tab content: Cognition ───────────────────────────────────────────
  const cognition = (
    <div>
      <Group>
        <GroupHead
          title={t('Chat.agentCenterSourceDetails', { defaultValue: 'Source details' })}
          right={<StatusPill tone={props.runtimeInspectLoading ? 'checking' : (props.runtimeInspect ? 'ready' : 'muted')} label={cognitionStatus} />}
        />
        <Card className="px-1 py-1">
          <KvGrid>
            <Kv label={t('Chat.agentCenterPersonality', { defaultValue: 'Personality' })} value={props.activeTarget?.bio || notProvided} muted={!props.activeTarget?.bio} />
            <Kv label={t('Chat.agentCenterWorldview', { defaultValue: 'Worldview' })} value={worldLabel} muted={!props.activeTarget?.worldName} />
            <Kv label={t('Chat.agentCenterOwnership', { defaultValue: 'Ownership' })} value={ownershipLabel} mono muted={!props.activeTarget?.ownershipType} />
            <Kv label={t('Chat.agentCenterActivity', { defaultValue: 'Activity' })} value={currentActivityLabel} muted={!props.runtimeInspect?.executionState} />
            <Kv label={t('Chat.agentCenterStatusText', { defaultValue: 'Status note' })} value={currentStatusLabel} muted={!props.runtimeInspect?.statusText} />
            <Kv label={t('Chat.agentCenterReferenceImage', { defaultValue: 'Reference image' })} value={imageStatus} muted={!props.activeTarget?.avatarUrl} />
            <Kv label={t('Chat.agentCenterReferenceVoice', { defaultValue: 'Reference voice' })} value={voiceStatus} muted />
            <Kv label={t('Chat.agentCenterCognitionState', { defaultValue: 'Cognition state' })} value={cognitionStatus} tone={props.runtimeInspectLoading ? 'sky' : undefined} />
          </KvGrid>
        </Card>
      </Group>
      <Group>
        <GroupHead title={t('Chat.agentCenterCognitionTitle', { defaultValue: 'Cognition status' })} />
        <Card>
          <Row
            label={t('Chat.agentCenterCognitionStatus', { defaultValue: 'Cognition' })}
            right={<StatusPill tone={props.runtimeInspectLoading ? 'checking' : (props.runtimeInspect ? 'ready' : 'muted')} label={cognitionStatus} />}
          />
          <Row
            label={t('Chat.agentCenterCurrentState', { defaultValue: 'Current state' })}
            right={<StatusPill tone={props.runtimeInspectLoading ? 'checking' : (props.runtimeInspect ? 'ready' : 'muted')} label={runtimeStatus} />}
          />
        </Card>
      </Group>
      {props.cognitionContent}
    </div>
  );

  // ── Tab content: Advanced ────────────────────────────────────────────
  const advanced = (
    <div>
      <WarnBanner>
        <strong className="font-semibold">{t('Chat.agentCenterAdvancedWarnTitle', { defaultValue: 'Diagnostics & runtime overrides.' })}</strong>{' '}
        {t('Chat.agentCenterAdvancedWarnBody', { defaultValue: 'These controls are intended for development. Changes can desync runtime state — proceed with care.' })}
      </WarnBanner>
      {props.diagnosticsContent || (
        <div className="rounded-xl border border-slate-200/90 bg-white px-4 py-6 text-center text-[12px] text-slate-500">
          {t('Chat.agentCenterDiagnosticsUnavailable', { defaultValue: 'Diagnostics unavailable.' })}
        </div>
      )}
    </div>
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

  // Badge counts surfaced on the icon-only nav buttons.
  const sectionBadges: Partial<Record<AgentCenterSectionId, number>> = {
    overview: remaining > 0 ? remaining : undefined,
  };

  return (
    <div className="min-h-0" data-chat-agent-center="true">
      <div className="flex min-h-0 flex-col gap-3">
        {/* Horizontal dynamic-expand navigation: active item shows icon+label, others stay icon-only.
            Top/right padding gives floating badges (which sit at -top-1.5 / -right-1.5) clearance
            inside the scroll container — overflow-x:auto otherwise clips the y-axis too. */}
        <nav
          aria-label={t('Chat.agentCenterNavigation', { defaultValue: 'Agent Center sections' })}
          className="flex shrink-0 items-center gap-1 overflow-x-auto px-1.5 pt-2.5 pb-1"
        >
          {sections.map((section) => {
            const Icon = SECTION_ICONS[section.id];
            const selected = section.id === activeSection;
            const badge = sectionBadges[section.id];
            return (
              <button
                key={section.id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                aria-label={section.label}
                title={section.label}
                data-testid={E2E_IDS.chatAgentCenterSection(section.id)}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'group relative flex h-9 shrink-0 items-center rounded-[12px] text-[12px] font-medium',
                  'transition-[width,background-color,color,padding] duration-300 ease-[cubic-bezier(0.32,0.72,0.0,1)]',
                  selected
                    ? 'bg-emerald-500/15 px-3 text-emerald-800'
                    : 'w-9 justify-center px-0 text-slate-500 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                <span
                  className={cn(
                    'overflow-hidden whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0.0,1)]',
                    selected ? 'ml-2 max-w-[160px] opacity-100' : 'ml-0 max-w-0 opacity-0',
                  )}
                >
                  {section.compactLabel || section.label}
                </span>
                {badge ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm ring-2 ring-white"
                  >
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Content area */}
        <section className="min-w-0 flex-1" aria-label={active.label}>
          <div className="mb-3">
            <h4 className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{active.label}</h4>
          </div>
          {contentBySection[active.id]}
        </section>
      </div>
    </div>
  );
}
