import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createModRuntimeClient, type AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { ConversationCapabilitySettingsSection } from './chat-conversation-capability-settings';
import {
  createSnapshotRouteDataProvider,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker';
import {
  ModelPickerModal,
  ModelSelectorTrigger,
} from '@nimiplatform/nimi-kit/features/model-picker/ui';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import {
  schedulingDetailKey,
  schedulingTitleKey,
  useSchedulingFeasibility,
} from './chat-execution-scheduling-guard';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { loadUserProfiles } from '../runtime-config/runtime-config-profile-storage';
import { applyAIProfileToConfig } from '@nimiplatform/sdk/mod';

type ChatSettingsPanelProps = {
  /** 'ai' shows full capability editors; 'human' shows diagnostics only. Defaults to 'ai'. */
  mode?: 'ai' | 'human';
  headerSlot?: ReactNode;
  modelPickerContent?: ReactNode;
  onModelSelectionChange?: (selection: RouteModelPickerSelection) => void;
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  diagnosticsContent?: ReactNode;
  presenceContent?: ReactNode;
  unavailableReason?: string;
};

function SettingsSection(props: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {props.title}
      </h3>
      {props.children}
      <div className="border-b border-slate-100" />
    </div>
  );
}

function CapabilityAccordionSection(props: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center justify-between py-2.5"
      >
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          {props.title}
        </h3>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={[
            'shrink-0 text-slate-300 transition-transform duration-200',
            props.expanded ? 'rotate-180' : '',
          ].join(' ')}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {props.expanded ? (
        <div className="pb-3">
          {props.children}
        </div>
      ) : null}
      <div className="border-b border-slate-100" />
    </div>
  );
}

export function DisabledSettingsNote(props: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-500">
      {props.label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduling Warning Banner (K-SCHED-001 five-state UI consumption)
// ---------------------------------------------------------------------------

const SCHEDULING_STYLE: Record<string, { border: string; bg: string; text: string; icon: string }> = {
  denied: { border: 'border-red-200', bg: 'bg-red-50/70', text: 'text-red-700', icon: 'text-red-400' },
  queue_required: { border: 'border-blue-200', bg: 'bg-blue-50/70', text: 'text-blue-700', icon: 'text-blue-400' },
  preemption_risk: { border: 'border-amber-200', bg: 'bg-amber-50/70', text: 'text-amber-700', icon: 'text-amber-400' },
  slowdown_risk: { border: 'border-amber-200', bg: 'bg-amber-50/70', text: 'text-amber-700', icon: 'text-amber-400' },
  unknown: { border: 'border-slate-200', bg: 'bg-slate-50/70', text: 'text-slate-600', icon: 'text-slate-400' },
};

/**
 * Renders a typed scheduling warning banner for non-runnable scheduling states.
 * All data comes from AIConfigProbeResult.schedulingJudgement — no local inference.
 */
export function SchedulingWarningBanner(props: { judgement: AISchedulingJudgement }) {
  const { t } = useTranslation();
  const { state, detail, occupancy, resourceWarnings } = props.judgement;

  if (state === 'runnable') return null;

  const style = SCHEDULING_STYLE[state] ?? SCHEDULING_STYLE.unknown!;

  return (
    <div
      className={`rounded-xl border ${style.border} ${style.bg} px-3 py-3 space-y-1.5`}
      data-testid="scheduling-warning-banner"
      data-scheduling-state={state}
    >
      <div className={`text-[11px] font-semibold ${style.text}`}>
        {t(schedulingTitleKey(state))}
      </div>
      <div className={`text-[11px] ${style.text} opacity-80`}>
        {t(schedulingDetailKey(state), { detail: detail || '' })}
      </div>
      {occupancy ? (
        <div className={`text-[10px] ${style.icon}`}>
          {t('Chat.schedulingOccupancy', {
            used: occupancy.globalUsed,
            cap: occupancy.globalCap,
            appUsed: occupancy.appUsed,
            appCap: occupancy.appCap,
          })}
        </div>
      ) : null}
      {resourceWarnings.length > 0 ? (
        <div className="space-y-0.5">
          {resourceWarnings.map((warning, idx) => (
            <div key={idx} className={`text-[10px] ${style.icon}`}>
              {t('Chat.schedulingResourceWarning', { warning })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const CORE_RUNTIME_MOD_ID = 'core:runtime';

/**
 * Creates a snapshot-driven route data provider for the given capability.
 * Uses `runtime.route.listOptions(...)` as the single authority.
 */
function createCapabilitySnapshotProvider(capability: string): RouteModelPickerDataProvider | null {
  try {
    const modClient = createModRuntimeClient(CORE_RUNTIME_MOD_ID);
    return createSnapshotRouteDataProvider(
      () => modClient.route.listOptions({
        capability: capability as Parameters<typeof modClient.route.listOptions>[0]['capability'],
      }),
    );
  } catch {
    return null;
  }
}

function AIProfilePickerCard() {
  const { t } = useTranslation();
  const profileOrigin = useAppStore((state) => state.aiConfig.profileOrigin);
  const scopeRef = useAppStore((state) => state.aiConfig.scopeRef);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const surface = useMemo(() => getDesktopAIConfigService(), []);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['ai-profiles', 'surface-and-user'],
    queryFn: async (): Promise<Awaited<ReturnType<typeof surface.aiProfile.list>>> => {
      const runtimeProfiles = await surface.aiProfile.list();
      const userProfiles = loadUserProfiles();
      return [...runtimeProfiles, ...userProfiles];
    },
    enabled: modalOpen,
  });

  const profiles = useMemo(() => profileQuery.data || [], [profileQuery.data]);

  const handleConfirmApply = () => {
    if (!selectedId) return;
    setApplyError(null);
    setApplying(true);

    // Try runtime surface first, fall back to user profile direct apply
    surface.aiProfile.apply(scopeRef, selectedId)
      .then((result) => {
        if (result.success) {
          setModalOpen(false);
          setSelectedId(null);
        } else {
          // Maybe it's a user profile — apply directly
          const userProfile = loadUserProfiles().find((p) => p.profileId === selectedId);
          if (userProfile) {
            const currentConfig = surface.aiConfig.get(scopeRef);
            const newConfig = applyAIProfileToConfig(currentConfig, userProfile);
            surface.aiConfig.update(scopeRef, newConfig);
            setModalOpen(false);
            setSelectedId(null);
          } else {
            setApplyError(result.failureReason || t('Chat.settingsAIProfileApplyFailed', {
              defaultValue: 'Failed to apply profile.',
            }));
          }
        }
      })
      .catch((error: unknown) => {
        setApplyError(
          error instanceof Error
            ? error.message
            : t('Chat.settingsAIProfileApplyFailed', { defaultValue: 'Failed to apply profile.' }),
        );
      })
      .finally(() => setApplying(false));
  };

  const handleNavigateToProfiles = () => {
    setActiveTab('runtime');
    // Delay dispatch to allow runtime panel to mount and register the listener
    setTimeout(() => dispatchRuntimeConfigOpenPage('profiles'), 100);
  };

  return (
    <>
      {/* Compact inline profile bar */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-[11px] font-medium text-[var(--nimi-text-muted)]">
            {t('Chat.settingsAIProfileTitle', { defaultValue: 'AI Profile' })}
          </span>
          {profileOrigin ? (
            <span className="truncate text-[11px] text-[var(--nimi-text-secondary)]">
              {profileOrigin.title || profileOrigin.profileId}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,transparent)] transition-colors"
            onClick={() => setModalOpen(true)}
          >
            {profileOrigin
              ? t('Chat.settingsAIProfileChange', { defaultValue: 'Change' })
              : t('Chat.settingsAIProfileApplyBtn', { defaultValue: 'Apply profile' })}
          </button>
          <button
            type="button"
            className="rounded-lg p-1 text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-surface-card)] hover:text-[var(--nimi-text-primary)] transition-colors"
            title={t('Chat.settingsAIProfileManage', { defaultValue: 'Manage profiles' })}
            onClick={handleNavigateToProfiles}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Profile selection modal */}
      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setModalOpen(false); setSelectedId(null); setApplyError(null); }} />
          <div className="relative z-10 mx-4 flex max-h-[70vh] w-full max-w-md flex-col rounded-2xl border border-[var(--nimi-border-subtle)] bg-white shadow-xl">
            {/* Header */}
            <div className="shrink-0 border-b border-[var(--nimi-border-subtle)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                {t('Chat.settingsAIProfileModalTitle', { defaultValue: 'Apply AI Profile' })}
              </h3>
              <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                {t('Chat.settingsAIProfileModalHint', {
                  defaultValue: 'Selecting a profile will overwrite all current capability bindings (Chat, TTS, Image, Video). This action cannot be undone.',
                })}
              </p>
            </div>

            {/* Profile list */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {profileQuery.isPending ? (
                <DisabledSettingsNote label={t('Chat.settingsLoading', { defaultValue: 'Loading profiles...' })} />
              ) : profileQuery.isError ? (
                <DisabledSettingsNote
                  label={profileQuery.error instanceof Error
                    ? profileQuery.error.message
                    : t('Chat.settingsAIProfileLoadFailed', { defaultValue: 'Failed to load AI profiles.' })}
                />
              ) : profiles.length === 0 ? (
                <DisabledSettingsNote label={t('Chat.settingsAIProfileEmpty', { defaultValue: 'No profiles available.' })} />
              ) : (
                <div className="space-y-2">
                  {profiles.map((profile) => {
                    const isSelected = selectedId === profile.profileId;
                    const isCurrent = profileOrigin?.profileId === profile.profileId;
                    return (
                      <button
                        key={profile.profileId}
                        type="button"
                        className={[
                          'w-full rounded-xl border px-3 py-3 text-left transition-colors',
                          isSelected
                            ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)]'
                            : 'border-[var(--nimi-border-subtle)] bg-white hover:border-[var(--nimi-border-strong)]',
                        ].join(' ')}
                        onClick={() => setSelectedId(profile.profileId)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--nimi-text-primary)]">
                            {profile.title || profile.profileId}
                          </span>
                          {isCurrent ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                              {t('Chat.settingsAIProfileCurrent', { defaultValue: 'Current' })}
                            </span>
                          ) : null}
                        </div>
                        {profile.description ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--nimi-text-muted)]">
                            {profile.description}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
              {applyError ? (
                <div className="mt-2">
                  <DisabledSettingsNote label={applyError} />
                </div>
              ) : null}
            </div>

            {/* Footer */}
            <div className="shrink-0 flex items-center justify-between border-t border-[var(--nimi-border-subtle)] px-5 py-3">
              <button
                type="button"
                className="text-xs text-[var(--nimi-action-primary-bg)] hover:underline"
                onClick={() => { setModalOpen(false); handleNavigateToProfiles(); }}
              >
                {t('Chat.settingsAIProfileManageLink', { defaultValue: 'Manage profiles in AI Runtime' })}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-4 py-2 text-xs text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-card)] transition-colors"
                  onClick={() => { setModalOpen(false); setSelectedId(null); setApplyError(null); }}
                >
                  {t('Chat.settingsAIProfileCancel', { defaultValue: 'Cancel' })}
                </button>
                <button
                  type="button"
                  disabled={!selectedId || applying}
                  className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-4 py-2 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  onClick={handleConfirmApply}
                >
                  {applying
                    ? t('Chat.settingsAIProfileApplying', { defaultValue: 'Applying...' })
                    : t('Chat.settingsAIProfileConfirm', { defaultValue: 'Confirm & Apply' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function useModelPickerProvider(): RouteModelPickerDataProvider | null {
  const providerRef = useRef<RouteModelPickerDataProvider | null>(null);
  if (!providerRef.current) {
    providerRef.current = createCapabilitySnapshotProvider('text.generate');
  }
  return providerRef.current;
}

function ModelSelectorWithModal(props: {
  capability: string;
  capabilityLabel: string;
  provider: RouteModelPickerDataProvider;
  initialSelection?: Partial<RouteModelPickerSelection>;
  onSelect: (selection: RouteModelPickerSelection) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const source = props.initialSelection?.source || null;
  const connector = props.initialSelection?.connectorId || null;
  const detail = source === 'cloud' && connector ? connector : null;
  const displayLabel = props.initialSelection?.modelLabel || null;

  return (
    <>
      <ModelSelectorTrigger
        source={source}
        modelLabel={displayLabel}
        detail={detail}
        placeholder={props.placeholder}
        onClick={() => setModalOpen(true)}
        disabled={props.disabled}
      />
      <ModelPickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        capability={props.capability}
        capabilityLabel={props.capabilityLabel}
        provider={props.provider}
        initialSelection={props.initialSelection}
        onSelect={props.onSelect}
      />
    </>
  );
}

/**
 * Self-contained section that probes scheduling feasibility and renders
 * the appropriate warning banner. Renders nothing when state is 'runnable'
 * or when the probe is not yet available.
 */
function SchedulingWarningSection() {
  const judgement = useSchedulingFeasibility();
  if (!judgement || judgement.state === 'runnable') return null;
  return <SchedulingWarningBanner judgement={judgement} />;
}

export function ChatSettingsPanel({
  mode = 'ai',
  headerSlot,
  modelPickerContent,
  onModelSelectionChange,
  initialModelSelection,
  diagnosticsContent,
  unavailableReason,
}: ChatSettingsPanelProps) {
  const { t } = useTranslation();
  const provider = useModelPickerProvider();
  const [expandedSection, setExpandedSection] = useState<'tts' | 'image' | 'video' | null>(null);
  const toggleSection = (section: 'tts' | 'image' | 'video') => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };
  const resolvedUnavailableReason = unavailableReason || t('Chat.settingsUnavailableReason', {
    defaultValue: 'This source does not expose runtime inspect yet.',
  });

  return (
    <div className="space-y-5">
      {headerSlot}

      {/* AI Profile */}
      {mode === 'ai' ? <AIProfilePickerCard /> : null}

      {/* Chat */}
      <SettingsSection title={t('Chat.settingsChatSection', { defaultValue: 'Chat' })}>
        {modelPickerContent || (provider && onModelSelectionChange ? (
          <ModelSelectorWithModal
            capability="text.generate"
            capabilityLabel={t('Chat.settingsChatModel', { defaultValue: 'Chat Model' })}
            provider={provider}
            initialSelection={initialModelSelection}
            onSelect={onModelSelectionChange}
            placeholder={t('Chat.settingsSelectModel', { defaultValue: 'Select a chat model' })}
          />
        ) : (
          <DisabledSettingsNote label={t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })} />
        ))}
      </SettingsSection>

      {mode === 'ai' ? (
        <>
          {/* TTS */}
          <CapabilityAccordionSection
            title={t('Chat.settingsTtsSection', { defaultValue: 'TTS' })}
            expanded={expandedSection === 'tts'}
            onToggle={() => toggleSection('tts')}
          >
            <ConversationCapabilitySettingsSection section="voice" />
          </CapabilityAccordionSection>

          {/* Image */}
          <CapabilityAccordionSection
            title={t('Chat.settingsImageSection', { defaultValue: 'Image' })}
            expanded={expandedSection === 'image'}
            onToggle={() => toggleSection('image')}
          >
            <ConversationCapabilitySettingsSection section="image" />
          </CapabilityAccordionSection>

          {/* Video */}
          <CapabilityAccordionSection
            title={t('Chat.settingsVideoSection', { defaultValue: 'Video' })}
            expanded={expandedSection === 'video'}
            onToggle={() => toggleSection('video')}
          >
            <ConversationCapabilitySettingsSection section="video" />
          </CapabilityAccordionSection>
        </>
      ) : null}

      {/* Scheduling Warning — K-SCHED-001 five-state UI consumption */}
      <SchedulingWarningSection />

      {/* Diagnostics */}
      <SettingsSection title={t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}>
        {diagnosticsContent || (
          <DisabledSettingsNote label={resolvedUnavailableReason} />
        )}
      </SettingsSection>
    </div>
  );
}
