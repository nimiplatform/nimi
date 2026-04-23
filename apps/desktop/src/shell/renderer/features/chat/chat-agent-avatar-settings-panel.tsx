import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import {
  buildDesktopAvatarInstanceId,
  closeDesktopAvatarHandoff,
  launchDesktopAvatarHandoff,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-launcher';
import {
  type DesktopAvatarLiveInstanceRecord,
  desktopAvatarInstanceRegistryQueryKey,
  listDesktopAvatarLiveInstances,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-instance-registry';
import { createRuntimeAgentPresentationProfileAdapter } from '@renderer/infra/runtime-agent-presentation-profile';
import { ChatAgentAvatarAppLauncher } from './chat-agent-avatar-app-launcher';
import { ChatAgentAvatarBindingSettings } from './chat-agent-avatar-binding-settings';
import {
  hasAvatarInstanceInLiveInventory,
  resolveAvatarInstanceCloseFeedback,
  resolveAvatarInstanceLaunchFeedback,
} from './chat-agent-avatar-instance-action-feedback';
import {
  loadStoredAgentAvatarLaunchPolicy,
  persistStoredAgentAvatarLaunchPolicy,
  type AgentAvatarLaunchPolicy,
} from './chat-agent-avatar-launch-policy-storage';

const CLOSE_CONFIRMATION_ATTEMPTS = 5;
const CLOSE_CONFIRMATION_DELAY_MS = 120;

type ChatAgentAvatarSettingsPanelProps = {
  selectedTarget: {
    id: string;
    title: string;
  } | null;
  activeThreadId: string | null;
  activeConversationAnchorId: string | null;
  presentationProfile: AvatarPresentationProfile | null;
  onRefreshInspect?: () => unknown;
};

type AvatarProfileDraft = {
  backendKind: AvatarPresentationProfile['backendKind'];
  avatarAssetRef: string;
  expressionProfileRef: string;
  idlePreset: string;
  interactionPolicyRef: string;
  defaultVoiceReference: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireRuntimeSubjectUserId(): string {
  const subjectUserId = normalizeText((useAppStore.getState().auth.user as Record<string, unknown> | null)?.id);
  if (!subjectUserId) {
    throw new Error('desktop runtime agent presentation profile requires authenticated subject user id');
  }
  return subjectUserId;
}

const runtimeAgentPresentationProfileAdapter = createRuntimeAgentPresentationProfileAdapter({
  getSubjectUserId: requireRuntimeSubjectUserId,
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createProfileDraft(profile: AvatarPresentationProfile | null): AvatarProfileDraft {
  return {
    backendKind: profile?.backendKind || 'vrm',
    avatarAssetRef: profile?.avatarAssetRef || '',
    expressionProfileRef: profile?.expressionProfileRef || '',
    idlePreset: profile?.idlePreset || '',
    interactionPolicyRef: profile?.interactionPolicyRef || '',
    defaultVoiceReference: profile?.defaultVoiceReference || '',
  };
}

function updateDraftField<K extends keyof AvatarProfileDraft>(
  current: AvatarProfileDraft,
  field: K,
  value: AvatarProfileDraft[K],
): AvatarProfileDraft {
  return {
    ...current,
    [field]: value,
  };
}

function formatBackendLabel(
  value: AvatarPresentationProfile['backendKind'] | null | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (value) {
    case 'vrm':
      return t('Chat.avatarBackendVrmLabel', { defaultValue: 'VRM' });
    case 'live2d':
      return t('Chat.avatarBackendLive2dLabel', { defaultValue: 'Live2D' });
    case 'sprite2d':
      return t('Chat.avatarBackendSprite2dLabel', { defaultValue: 'Sprite 2D' });
    case 'canvas2d':
      return t('Chat.avatarBackendCanvas2dLabel', { defaultValue: 'Canvas 2D' });
    case 'video':
      return t('Chat.avatarBackendVideoLabel', { defaultValue: 'Video' });
    default:
      return t('Chat.avatarBackendUnboundLabel', { defaultValue: 'Unbound' });
  }
}

function SectionCard(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_95%,var(--nimi-surface-panel))] p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)]">
      <div className="space-y-1">
        <h3 className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">{props.title}</h3>
        <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

function DetailRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
        {props.label}
      </span>
      <span className="max-w-[65%] break-all text-right text-xs text-[var(--nimi-text-primary)]">
        {props.value}
      </span>
    </div>
  );
}

function formatLaunchModeLabel(value: 'existing' | 'open_new', t: ReturnType<typeof useTranslation>['t']): string {
  return value === 'existing'
    ? t('Chat.avatarSessionLinkModeExisting', { defaultValue: 'existing' })
    : t('Chat.avatarSessionLinkModeOpenNew', { defaultValue: 'open_new' });
}

export function ChatAgentAvatarSettingsPanel(props: ChatAgentAvatarSettingsPanelProps) {
  const { t } = useTranslation();
  const tauriReady = hasTauriInvoke();
  const anchorMode: 'existing' | 'open_new' = props.activeConversationAnchorId ? 'existing' : 'open_new';
  const [draft, setDraft] = useState<AvatarProfileDraft>(() => createProfileDraft(props.presentationProfile));
  const [pendingAction, setPendingAction] = useState<'save' | 'clear' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [instanceActionPendingKey, setInstanceActionPendingKey] = useState<string | null>(null);
  const [instanceActionFeedback, setInstanceActionFeedback] = useState<string | null>(null);
  const [instanceActionError, setInstanceActionError] = useState<string | null>(null);
  const [launchPolicy, setLaunchPolicy] = useState<AgentAvatarLaunchPolicy>(() => (
    loadStoredAgentAvatarLaunchPolicy(props.selectedTarget?.id)
  ));
  const avatarInstanceId = useMemo(() => {
    if (!props.selectedTarget) {
      return null;
    }
    return buildDesktopAvatarInstanceId({
      agentId: props.selectedTarget.id,
      threadId: props.activeThreadId,
      conversationAnchorId: props.activeConversationAnchorId,
    });
  }, [props.activeConversationAnchorId, props.activeThreadId, props.selectedTarget]);
  const modelBound = Boolean(props.presentationProfile?.avatarAssetRef);
  const canSave = Boolean(props.selectedTarget && draft.avatarAssetRef.trim());
  const liveInstancesQuery = useQuery({
    queryKey: props.selectedTarget?.id
      ? desktopAvatarInstanceRegistryQueryKey(props.selectedTarget.id)
      : ['desktop-avatar-instance-registry', 'none'],
    queryFn: async () => (props.selectedTarget ? listDesktopAvatarLiveInstances(props.selectedTarget.id) : []),
    enabled: tauriReady && Boolean(props.selectedTarget?.id),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: tauriReady && props.selectedTarget?.id && launchPolicy.autoRefreshLiveInventory ? 5_000 : false,
  });
  const liveInstances = liveInstancesQuery.data || [];
  const targetedLiveInstance = avatarInstanceId
    ? liveInstances.find((instance) => instance.avatarInstanceId === avatarInstanceId) || null
    : null;

  useEffect(() => {
    setDraft(createProfileDraft(props.presentationProfile));
    setFeedback(null);
    setErrorMessage(null);
    setPendingAction(null);
    setInstanceActionPendingKey(null);
    setInstanceActionFeedback(null);
    setInstanceActionError(null);
    setLaunchPolicy(loadStoredAgentAvatarLaunchPolicy(props.selectedTarget?.id));
  }, [props.presentationProfile, props.selectedTarget?.id]);

  const updateLaunchPolicy = (next: AgentAvatarLaunchPolicy) => {
    const persisted = persistStoredAgentAvatarLaunchPolicy(props.selectedTarget?.id, next);
    setLaunchPolicy(persisted);
  };

  const handleSave = async () => {
    if (!props.selectedTarget || !draft.avatarAssetRef.trim()) {
      return;
    }
    setPendingAction('save');
    setFeedback(null);
    setErrorMessage(null);
    try {
      await runtimeAgentPresentationProfileAdapter.setPresentationProfile(props.selectedTarget.id, {
        backendKind: draft.backendKind,
        avatarAssetRef: draft.avatarAssetRef.trim(),
        expressionProfileRef: draft.expressionProfileRef.trim() || null,
        idlePreset: draft.idlePreset.trim() || null,
        interactionPolicyRef: draft.interactionPolicyRef.trim() || null,
        defaultVoiceReference: draft.defaultVoiceReference.trim() || null,
      });
      setFeedback(t('Chat.avatarModelSavedFeedback', {
        defaultValue: 'Runtime avatar profile saved for this agent.',
      }));
      await props.onRefreshInspect?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error || ''));
    } finally {
      setPendingAction(null);
    }
  };

  const handleClear = async () => {
    if (!props.selectedTarget) {
      return;
    }
    setPendingAction('clear');
    setFeedback(null);
    setErrorMessage(null);
    try {
      await runtimeAgentPresentationProfileAdapter.setPresentationProfile(props.selectedTarget.id, null);
      setDraft(createProfileDraft(null));
      setFeedback(t('Chat.avatarModelClearedFeedback', {
        defaultValue: 'Runtime avatar profile cleared for this agent.',
      }));
      await props.onRefreshInspect?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error || ''));
    } finally {
      setPendingAction(null);
    }
  };

  const runInstanceAction = async (
    key: string,
    input: {
      avatarInstanceId: string;
      conversationAnchorId?: string | null;
      anchorMode: 'existing' | 'open_new';
    },
    messages: {
      success: string;
      unconfirmed: string;
    },
  ) => {
    if (!props.selectedTarget) {
      return;
    }
    setInstanceActionPendingKey(key);
    setInstanceActionFeedback(null);
    setInstanceActionError(null);
    try {
      const preflightResult = await liveInstancesQuery.refetch();
      if (preflightResult.isError) {
        setInstanceActionError(t('Chat.avatarSessionLinkLiveInventoryActionRefreshFailed', {
          defaultValue: 'Desktop could not refresh live inventory before running this companion action.',
        }));
        return;
      }
      const preflightInstances = preflightResult.data || [];
      if (!hasAvatarInstanceInLiveInventory(preflightInstances, input.avatarInstanceId)) {
        setInstanceActionError(t('Chat.avatarSessionLinkInstanceNotLive', {
          defaultValue: 'This companion is no longer present in live inventory. Refresh and try again.',
        }));
        return;
      }
      const result = await launchDesktopAvatarHandoff({
        agentId: props.selectedTarget.id,
        avatarInstanceId: input.avatarInstanceId,
        conversationAnchorId: input.conversationAnchorId,
        anchorMode: input.anchorMode,
        launchedBy: 'desktop',
        sourceSurface: 'desktop-agent-chat',
      });
      const feedback = resolveAvatarInstanceLaunchFeedback(result.opened);
      if (feedback.outcome === 'confirmed') {
        setInstanceActionFeedback(messages.success);
      } else {
        setInstanceActionError(messages.unconfirmed);
      }
      await liveInstancesQuery.refetch();
    } catch (error) {
      setInstanceActionError(error instanceof Error ? error.message : String(error || ''));
    } finally {
      setInstanceActionPendingKey(null);
    }
  };

  const handleRevealInstance = async (instance: DesktopAvatarLiveInstanceRecord) => {
    await runInstanceAction(
      `reveal:${instance.avatarInstanceId}`,
      {
        avatarInstanceId: instance.avatarInstanceId,
        conversationAnchorId: instance.conversationAnchorId,
        anchorMode: instance.anchorMode,
      },
      {
        success: t('Chat.avatarSessionLinkRevealSuccess', {
          defaultValue: 'Desktop asked Nimi Avatar to reveal this companion.',
        }),
        unconfirmed: t('Chat.avatarSessionLinkRevealUnconfirmed', {
          defaultValue: 'Desktop sent the reveal handoff, but the OS did not confirm that Nimi Avatar handled it.',
        }),
      },
    );
  };

  const handleRetargetInstance = async (instance: DesktopAvatarLiveInstanceRecord) => {
    await runInstanceAction(
      `retarget:${instance.avatarInstanceId}`,
      {
        avatarInstanceId: instance.avatarInstanceId,
        conversationAnchorId: props.activeConversationAnchorId,
        anchorMode,
      },
      {
        success: t('Chat.avatarSessionLinkRetargetSuccess', {
          defaultValue: 'Desktop retargeted this companion to the current chat.',
        }),
        unconfirmed: t('Chat.avatarSessionLinkRetargetUnconfirmed', {
          defaultValue: 'Desktop sent the retarget handoff, but the OS did not confirm that Nimi Avatar handled it.',
        }),
      },
    );
  };

  const handleCloseInstance = async (instance: DesktopAvatarLiveInstanceRecord) => {
    const key = `close:${instance.avatarInstanceId}`;
    setInstanceActionPendingKey(key);
    setInstanceActionFeedback(null);
    setInstanceActionError(null);
    try {
      const preflightResult = await liveInstancesQuery.refetch();
      if (preflightResult.isError) {
        setInstanceActionError(t('Chat.avatarSessionLinkLiveInventoryActionRefreshFailed', {
          defaultValue: 'Desktop could not refresh live inventory before running this companion action.',
        }));
        return;
      }
      const preflightInstances = preflightResult.data || [];
      if (!hasAvatarInstanceInLiveInventory(preflightInstances, instance.avatarInstanceId)) {
        setInstanceActionError(t('Chat.avatarSessionLinkInstanceNotLive', {
          defaultValue: 'This companion is no longer present in live inventory. Refresh and try again.',
        }));
        return;
      }
      const result = await closeDesktopAvatarHandoff({
        avatarInstanceId: instance.avatarInstanceId,
        closedBy: 'desktop',
        sourceSurface: 'desktop-agent-chat',
      });
      let refreshFailed = false;
      let refreshedInstances: DesktopAvatarLiveInstanceRecord[] = preflightInstances;
      if (result.opened) {
        for (let attempt = 0; attempt < CLOSE_CONFIRMATION_ATTEMPTS; attempt += 1) {
          if (attempt > 0) {
            await delay(CLOSE_CONFIRMATION_DELAY_MS);
          }
          const refreshResult = await liveInstancesQuery.refetch();
          if (refreshResult.isError) {
            refreshFailed = true;
            break;
          }
          refreshedInstances = refreshResult.data || [];
          if (!hasAvatarInstanceInLiveInventory(refreshedInstances, instance.avatarInstanceId)) {
            break;
          }
        }
      }
      const feedback = resolveAvatarInstanceCloseFeedback({
        opened: result.opened,
        inventoryRefreshFailed: refreshFailed,
        instanceStillLive: refreshedInstances.some((candidate) => (
          candidate.avatarInstanceId === instance.avatarInstanceId
        )),
      });
      let message: string;
      switch (feedback.outcome) {
        case 'confirmed':
          message = t('Chat.avatarSessionLinkCloseConfirmed', {
            defaultValue: 'Desktop asked Nimi Avatar to close this companion and it no longer appears in live inventory.',
          });
          break;
        case 'still_live':
          message = t('Chat.avatarSessionLinkCloseStillLive', {
            defaultValue: 'Desktop sent the close request, but this companion still appears in live inventory after refresh.',
          });
          break;
        case 'refresh_failed':
          message = t('Chat.avatarSessionLinkCloseRefreshFailed', {
            defaultValue: 'Desktop sent the close request, but could not refresh live inventory to confirm the result.',
          });
          break;
        default:
          message = t('Chat.avatarSessionLinkCloseUnconfirmed', {
            defaultValue: 'Desktop sent the close handoff, but the OS did not confirm that Nimi Avatar handled it.',
          });
          break;
      }
      if (feedback.outcome === 'confirmed') {
        setInstanceActionFeedback(message);
      } else {
        setInstanceActionError(message);
      }
    } catch (error) {
      setInstanceActionError(error instanceof Error ? error.message : String(error || ''));
    } finally {
      setInstanceActionPendingKey(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="chat-agent-avatar-settings-panel">
      <SectionCard
        title={t('Chat.avatarModelSectionTitle', { defaultValue: 'Avatar Model' })}
        description={t('Chat.avatarModelSectionDescription', {
          defaultValue: 'This agent’s persistent avatar presentation comes from runtime-owned profile truth. Desktop does not keep a separate local avatar binding library.',
        })}
      >
        {props.selectedTarget ? (
          <div className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_92%,white)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {props.selectedTarget.title}
                </p>
                <p className="text-xs text-[var(--nimi-text-muted)]">
                  {modelBound
                    ? t('Chat.avatarModelBoundState', {
                      defaultValue: 'Runtime presentation profile is bound for this agent.',
                    })
                    : t('Chat.avatarModelUnboundState', {
                      defaultValue: 'No runtime avatar model is currently bound for this agent.',
                    })}
                </p>
              </div>
              <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-action-primary-bg)] ring-1 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)]">
                {formatBackendLabel(props.presentationProfile?.backendKind, t)}
              </span>
            </div>
            <div className="space-y-2">
              <DetailRow
                label={t('Chat.avatarModelAssetLabel', { defaultValue: 'Asset' })}
                value={props.presentationProfile?.avatarAssetRef || t('Chat.avatarModelUnboundAsset', { defaultValue: 'Not bound' })}
              />
              <DetailRow
                label={t('Chat.avatarModelVoiceLabel', { defaultValue: 'Voice' })}
                value={props.presentationProfile?.defaultVoiceReference || t('Chat.avatarModelVoiceInherited', { defaultValue: 'Inherited / unset' })}
              />
            </div>
            <div className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_96%,white)] p-3">
              <div className="space-y-1">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-primary)]">
                  {t('Chat.avatarModelEditorTitle', { defaultValue: 'Restricted Runtime Profile Editor' })}
                </p>
                <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                  {t('Chat.avatarModelEditorDescription', {
                    defaultValue: 'This editor writes the runtime-owned profile directly. It does not import local files or create desktop-only avatar bindings.',
                  })}
                </p>
              </div>
              <label className="space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                  {t('Chat.avatarModelBackendLabel', { defaultValue: 'Backend' })}
                </span>
                <select
                  value={draft.backendKind}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      backendKind: event.target.value as AvatarPresentationProfile['backendKind'],
                    }));
                  }}
                  className="w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 py-2 text-sm text-[var(--nimi-text-primary)] outline-none transition focus:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,var(--nimi-border-subtle))]"
                >
                  <option value="vrm">{t('Chat.avatarBackendVrmLabel', { defaultValue: 'VRM' })}</option>
                  <option value="live2d">{t('Chat.avatarBackendLive2dLabel', { defaultValue: 'Live2D' })}</option>
                  <option value="sprite2d">{t('Chat.avatarBackendSprite2dLabel', { defaultValue: 'Sprite 2D' })}</option>
                  <option value="canvas2d">{t('Chat.avatarBackendCanvas2dLabel', { defaultValue: 'Canvas 2D' })}</option>
                  <option value="video">{t('Chat.avatarBackendVideoLabel', { defaultValue: 'Video' })}</option>
                </select>
              </label>
              {[
                ['avatarAssetRef', t('Chat.avatarModelAssetRefInput', { defaultValue: 'Avatar Asset Ref' })],
                ['expressionProfileRef', t('Chat.avatarModelExpressionRefInput', { defaultValue: 'Expression Profile Ref' })],
                ['idlePreset', t('Chat.avatarModelIdlePresetInput', { defaultValue: 'Idle Preset' })],
                ['interactionPolicyRef', t('Chat.avatarModelInteractionRefInput', { defaultValue: 'Interaction Policy Ref' })],
                ['defaultVoiceReference', t('Chat.avatarModelVoiceRefInput', { defaultValue: 'Default Voice Reference' })],
              ].map(([field, label]) => (
                <label key={field} className="space-y-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                    {label}
                  </span>
                  <input
                    value={draft[field as keyof AvatarProfileDraft]}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft((current) => updateDraftField(
                        current,
                        field as keyof AvatarProfileDraft,
                        value,
                      ));
                    }}
                    placeholder={field === 'avatarAssetRef' ? 'asset://...' : ''}
                    className="w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 py-2 text-sm text-[var(--nimi-text-primary)] outline-none transition focus:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,var(--nimi-border-subtle))]"
                  />
                </label>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!canSave || pendingAction !== null}
                  onClick={() => {
                    void handleSave();
                  }}
                >
                  {pendingAction === 'save'
                    ? t('Chat.avatarModelSavePending', { defaultValue: 'Saving…' })
                    : t('Chat.avatarModelSaveAction', { defaultValue: 'Save Runtime Profile' })}
                </Button>
                <Button
                  tone="ghost"
                  size="sm"
                  disabled={!props.selectedTarget || pendingAction !== null}
                  onClick={() => {
                    void handleClear();
                  }}
                >
                  {pendingAction === 'clear'
                    ? t('Chat.avatarModelClearPending', { defaultValue: 'Clearing…' })
                    : t('Chat.avatarModelClearAction', { defaultValue: 'Clear Runtime Profile' })}
                </Button>
              </div>
              {feedback ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-success)_20%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-success)]">
                  {feedback}
                </div>
              ) : null}
              {errorMessage ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_6%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">
                  {errorMessage}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
            {t('Chat.avatarModelNoTarget', { defaultValue: 'Select an agent target to inspect avatar model state.' })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t('Chat.avatarLaunchSectionTitle', { defaultValue: 'Companion Launch' })}
        description={t('Chat.avatarLaunchSectionDescription', {
          defaultValue: 'Desktop remains the first-party launcher for Nimi Avatar. This section only uses the admitted handoff path for the current chat.',
        })}
      >
        {props.selectedTarget ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_92%,white)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
              {tauriReady
                ? t('Chat.avatarLaunchReadyNotice', {
                  defaultValue: 'Desktop can hand off the selected agent and current chat continuity to Nimi Avatar.',
                })
                : t('Chat.avatarLaunchUnavailableNotice', {
                  defaultValue: 'Desktop avatar handoff is available only in the desktop shell runtime.',
                })}
            </div>
            <ChatAgentAvatarAppLauncher
              selectedTarget={props.selectedTarget}
              activeThreadId={props.activeThreadId}
              activeConversationAnchorId={props.activeConversationAnchorId}
              defaultLaunchTarget={launchPolicy.defaultLaunchTarget}
            />
            <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_92%,white)] p-3">
              <div className="space-y-1">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-primary)]">
                  {t('Chat.avatarLaunchPolicyTitle', { defaultValue: 'Launch Policy' })}
                </p>
                <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                  {t('Chat.avatarLaunchPolicyDescription', {
                    defaultValue: 'These preferences stay local to this desktop shell. They guide launcher defaults and inventory refresh, but never change runtime presentation truth.',
                  })}
                </p>
              </div>
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                    {t('Chat.avatarLaunchPolicyDefaultTargetLabel', { defaultValue: 'Default launch target' })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      tone={launchPolicy.defaultLaunchTarget === 'current' ? undefined : 'ghost'}
                      onClick={() => {
                        updateLaunchPolicy({
                          ...launchPolicy,
                          defaultLaunchTarget: 'current',
                        });
                      }}
                    >
                      {t('Chat.avatarLaunchPolicyDefaultCurrent', { defaultValue: 'Reuse current target' })}
                    </Button>
                    <Button
                      size="sm"
                      tone={launchPolicy.defaultLaunchTarget === 'new' ? undefined : 'ghost'}
                      onClick={() => {
                        updateLaunchPolicy({
                          ...launchPolicy,
                          defaultLaunchTarget: 'new',
                        });
                      }}
                    >
                      {t('Chat.avatarLaunchPolicyDefaultNew', { defaultValue: 'Prefer new companion' })}
                    </Button>
                  </div>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--nimi-border-subtle)] px-3 py-2.5">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-[var(--nimi-text-primary)]">
                      {t('Chat.avatarLaunchPolicyAutoRefreshLabel', { defaultValue: 'Auto-refresh live inventory' })}
                    </p>
                    <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                      {t('Chat.avatarLaunchPolicyAutoRefreshDescription', {
                        defaultValue: 'When enabled, desktop keeps polling avatar-published live instances for this agent.',
                      })}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={launchPolicy.autoRefreshLiveInventory}
                    onChange={(event) => {
                      updateLaunchPolicy({
                        ...launchPolicy,
                        autoRefreshLiveInventory: event.currentTarget.checked,
                      });
                    }}
                    className="h-4 w-4 rounded border-[var(--nimi-border-subtle)] text-[var(--nimi-action-primary-bg)] focus:ring-[var(--nimi-action-primary-bg)]"
                  />
                </label>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
            {t('Chat.avatarLaunchNoTarget', { defaultValue: 'Select an agent target before opening a companion avatar.' })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t('Chat.avatarSessionLinkSectionTitle', { defaultValue: 'Session Link' })}
        description={t('Chat.avatarSessionLinkSectionDescription', {
          defaultValue: 'This section shows current desktop targeting and avatar-published live companion instances for the selected agent.',
        })}
      >
        {props.selectedTarget ? (
          <div className="space-y-3">
            <div className="space-y-2 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_92%,white)] p-3">
              <DetailRow
                label={t('Chat.avatarSessionLinkAgent', { defaultValue: 'Agent' })}
                value={props.selectedTarget.title}
              />
              <DetailRow
                label={t('Chat.avatarSessionLinkThread', { defaultValue: 'Thread' })}
                value={props.activeThreadId || t('Chat.avatarSessionLinkThreadUnbound', { defaultValue: 'No active thread' })}
              />
              <DetailRow
                label={t('Chat.avatarSessionLinkAnchor', { defaultValue: 'Anchor' })}
                value={props.activeConversationAnchorId || t('Chat.avatarSessionLinkAnchorOpenNew', { defaultValue: 'Open new anchor on launch' })}
              />
              <DetailRow
                label={t('Chat.avatarSessionLinkMode', { defaultValue: 'Launch mode' })}
                value={formatLaunchModeLabel(anchorMode, t)}
              />
              <DetailRow
                label={t('Chat.avatarSessionLinkInstance', { defaultValue: 'Instance ID' })}
                value={avatarInstanceId || t('Chat.avatarSessionLinkInstanceUnknown', { defaultValue: 'Unavailable' })}
              />
              <DetailRow
                label={t('Chat.avatarSessionLinkLiveStatus', { defaultValue: 'Live status' })}
                value={targetedLiveInstance
                  ? t('Chat.avatarSessionLinkLiveStatusBound', { defaultValue: 'Current target is active in Nimi Avatar' })
                  : t('Chat.avatarSessionLinkLiveStatusPending', { defaultValue: 'Current target is not present in live inventory yet' })}
              />
            </div>

            <div className="space-y-2 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_92%,white)] p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-primary)]">
                  {t('Chat.avatarSessionLinkLiveInventoryTitle', { defaultValue: 'Live Companion Instances' })}
                </p>
                <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-action-primary-bg)] ring-1 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)]">
                  {t('Chat.avatarSessionLinkLiveInventoryCount', {
                    defaultValue: '{{count}} live',
                    count: liveInstances.length,
                  })}
                </span>
              </div>
              <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
                {t('Chat.avatarSessionLinkLiveInventoryDescription', {
                  defaultValue: 'Desktop reads this inventory from the avatar-published projection. It does not fabricate local companion truth.',
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  tone="ghost"
                  size="sm"
                  disabled={liveInstancesQuery.isFetching}
                  onClick={() => {
                    void liveInstancesQuery.refetch();
                  }}
                >
                  {liveInstancesQuery.isFetching
                    ? t('Chat.avatarSessionLinkLiveInventoryRefreshing', { defaultValue: 'Refreshing…' })
                    : t('Chat.avatarSessionLinkLiveInventoryRefresh', { defaultValue: 'Refresh Live Inventory' })}
                </Button>
              </div>
              {liveInstancesQuery.isLoading ? (
                <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
                  {t('Chat.avatarSessionLinkLiveInventoryLoading', { defaultValue: 'Loading live companion inventory…' })}
                </div>
              ) : null}
              {liveInstancesQuery.error ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_6%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">
                  {liveInstancesQuery.error instanceof Error
                    ? liveInstancesQuery.error.message
                    : t('Chat.avatarSessionLinkLiveInventoryError', { defaultValue: 'Failed to load live companion inventory.' })}
                </div>
              ) : null}
              {!liveInstancesQuery.isLoading && !liveInstances.length ? (
                <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
                  {t('Chat.avatarSessionLinkLiveInventoryEmpty', {
                    defaultValue: 'No live companion instances are currently published for this agent.',
                  })}
                </div>
              ) : null}
              {instanceActionFeedback ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-success)_20%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-success)]">
                  {instanceActionFeedback}
                </div>
              ) : null}
              {instanceActionError ? (
                <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_6%,transparent)] px-3 py-2 text-xs text-[var(--nimi-status-danger)]">
                  {instanceActionError}
                </div>
              ) : null}
              {liveInstances.length ? (
                <div className="space-y-2">
                  {liveInstances.map((instance) => {
                    const isTargeted = instance.avatarInstanceId === avatarInstanceId;
                    return (
                      <div
                        key={instance.avatarInstanceId}
                        className="space-y-2 rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                            {instance.avatarInstanceId}
                          </p>
                          {isTargeted ? (
                            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-status-success)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)]">
                              {t('Chat.avatarSessionLinkLiveInventoryCurrentTarget', { defaultValue: 'Current target' })}
                            </span>
                          ) : null}
                        </div>
                        <DetailRow
                          label={t('Chat.avatarSessionLinkAnchor', { defaultValue: 'Anchor' })}
                          value={instance.conversationAnchorId || t('Chat.avatarSessionLinkAnchorOpenNew', { defaultValue: 'Open new anchor on launch' })}
                        />
                        <DetailRow
                          label={t('Chat.avatarSessionLinkMode', { defaultValue: 'Launch mode' })}
                          value={formatLaunchModeLabel(instance.anchorMode, t)}
                        />
                        <DetailRow
                          label={t('Chat.avatarSessionLinkSourceSurface', { defaultValue: 'Source surface' })}
                          value={instance.sourceSurface || t('Chat.avatarSessionLinkSourceSurfaceUnknown', { defaultValue: 'Unavailable' })}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            tone="secondary"
                            size="sm"
                            disabled={instanceActionPendingKey !== null}
                            onClick={() => {
                              void handleRevealInstance(instance);
                            }}
                          >
                            {instanceActionPendingKey === `reveal:${instance.avatarInstanceId}`
                              ? t('Chat.avatarSessionLinkRevealPending', { defaultValue: 'Revealing…' })
                              : t('Chat.avatarSessionLinkRevealAction', { defaultValue: 'Reveal' })}
                          </Button>
                          <Button
                            tone="ghost"
                            size="sm"
                            disabled={instanceActionPendingKey !== null}
                            onClick={() => {
                              void handleRetargetInstance(instance);
                            }}
                          >
                            {instanceActionPendingKey === `retarget:${instance.avatarInstanceId}`
                              ? t('Chat.avatarSessionLinkRetargetPending', { defaultValue: 'Retargeting…' })
                              : t('Chat.avatarSessionLinkRetargetAction', { defaultValue: 'Retarget Here' })}
                          </Button>
                          <Button
                            tone="ghost"
                            size="sm"
                            disabled={instanceActionPendingKey !== null}
                            onClick={() => {
                              void handleCloseInstance(instance);
                            }}
                          >
                            {instanceActionPendingKey === `close:${instance.avatarInstanceId}`
                              ? t('Chat.avatarSessionLinkClosePending', { defaultValue: 'Closing…' })
                              : t('Chat.avatarSessionLinkCloseAction', { defaultValue: 'Close' })}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
            {t('Chat.avatarSessionLinkNoTarget', { defaultValue: 'Session link details appear after an agent target is selected.' })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t('Chat.avatarLocalShellSectionTitle', { defaultValue: 'Local Shell Appearance' })}
        description={t('Chat.avatarLocalShellSectionDescription', {
          defaultValue: 'These controls only change this desktop shell surface. They do not change runtime presentation truth or avatar-app carrier state.',
        })}
      >
        <ChatAgentAvatarBindingSettings
          agentId={props.selectedTarget?.id || null}
          agentName={props.selectedTarget?.title || null}
        />
      </SectionCard>
    </div>
  );
}
