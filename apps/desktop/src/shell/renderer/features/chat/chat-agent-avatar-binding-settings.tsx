import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  clearDesktopAgentAvatarBinding,
  deleteDesktopAgentAvatarResource,
  desktopAgentAvatarBindingQueryKey,
  desktopAgentAvatarResourcesQueryKey,
  getDesktopAgentAvatarBinding,
  importDesktopAgentAvatarLive2d,
  importDesktopAgentAvatarVrm,
  listDesktopAgentAvatarResources,
  pickDesktopAgentAvatarLive2dSourcePath,
  pickDesktopAgentAvatarVrmSourcePath,
  setDesktopAgentAvatarBinding,
} from '@renderer/bridge/runtime-bridge/chat-agent-avatar-store';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';

type ChatAgentAvatarBindingSettingsProps = {
  agentId: string | null;
  agentName: string | null;
};

function describeResourceKind(kind: 'vrm' | 'live2d'): string {
  return kind === 'live2d' ? 'Live2D' : 'VRM';
}

function describeResourceStatus(status: 'ready' | 'invalid' | 'missing'): string {
  if (status === 'ready') {
    return 'Ready';
  }
  if (status === 'missing') {
    return 'Missing';
  }
  return 'Invalid';
}

export function ChatAgentAvatarBindingSettings(props: ChatAgentAvatarBindingSettingsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);
  const tauriReady = hasTauriInvoke();
  const agentId = props.agentId || null;

  const resourcesQuery = useQuery({
    queryKey: desktopAgentAvatarResourcesQueryKey(),
    queryFn: listDesktopAgentAvatarResources,
    enabled: tauriReady,
    staleTime: 30_000,
  });

  const bindingQuery = useQuery({
    queryKey: agentId ? desktopAgentAvatarBindingQueryKey(agentId) : ['desktop-agent-avatar-binding', 'none'],
    queryFn: async () => (agentId ? getDesktopAgentAvatarBinding(agentId) : null),
    enabled: tauriReady && Boolean(agentId),
    staleTime: 30_000,
  });

  const currentResource = useMemo(() => {
    if (!bindingQuery.data) {
      return null;
    }
    return resourcesQuery.data?.find((item) => item.resourceId === bindingQuery.data?.resourceId) || null;
  }, [bindingQuery.data, resourcesQuery.data]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: desktopAgentAvatarResourcesQueryKey() });
    if (agentId) {
      await queryClient.invalidateQueries({ queryKey: desktopAgentAvatarBindingQueryKey(agentId) });
    }
  };

  const bindMutation = useMutation({
    mutationFn: async (resourceId: string) => {
      if (!agentId) {
        throw new Error('Agent selection is required');
      }
      return setDesktopAgentAvatarBinding({
        agentId,
        resourceId,
        updatedAtMs: Date.now(),
      });
    },
    onSuccess: async () => {
      setFeedback(t('Chat.avatarBindingBoundFeedback', { defaultValue: 'Local avatar binding updated.' }));
      await refresh();
    },
  });

  const clearBindingMutation = useMutation({
    mutationFn: async () => {
      if (!agentId) {
        throw new Error('Agent selection is required');
      }
      return clearDesktopAgentAvatarBinding(agentId);
    },
    onSuccess: async () => {
      setFeedback(t('Chat.avatarBindingClearedFeedback', { defaultValue: 'Local avatar binding cleared.' }));
      await refresh();
    },
  });

  const deleteResourceMutation = useMutation({
    mutationFn: async (resourceId: string) => deleteDesktopAgentAvatarResource(resourceId),
    onSuccess: async () => {
      setFeedback(t('Chat.avatarBindingDeletedFeedback', { defaultValue: 'Local avatar resource removed.' }));
      await refresh();
    },
  });

  const importVrmMutation = useMutation({
    mutationFn: async () => {
      const sourcePath = await pickDesktopAgentAvatarVrmSourcePath();
      if (!sourcePath || !agentId) {
        return null;
      }
      return importDesktopAgentAvatarVrm({
        sourcePath,
        bindAgentId: agentId,
        importedAtMs: Date.now(),
      });
    },
    onSuccess: async (result) => {
      if (!result) {
        return;
      }
      setFeedback(t('Chat.avatarBindingImportedVrmFeedback', { defaultValue: 'VRM imported and bound for this agent.' }));
      await refresh();
    },
  });

  const importLive2dMutation = useMutation({
    mutationFn: async () => {
      const sourcePath = await pickDesktopAgentAvatarLive2dSourcePath();
      if (!sourcePath || !agentId) {
        return null;
      }
      return importDesktopAgentAvatarLive2d({
        sourcePath,
        bindAgentId: agentId,
        importedAtMs: Date.now(),
      });
    },
    onSuccess: async (result) => {
      if (!result) {
        return;
      }
      setFeedback(t('Chat.avatarBindingImportedLive2dFeedback', { defaultValue: 'Live2D resource imported for this agent.' }));
      await refresh();
    },
  });

  const resources = (resourcesQuery.data || []).slice().sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  const pending = bindMutation.isPending
    || clearBindingMutation.isPending
    || deleteResourceMutation.isPending
    || importVrmMutation.isPending
    || importLive2dMutation.isPending;
  const error = bindMutation.error
    || clearBindingMutation.error
    || deleteResourceMutation.error
    || importVrmMutation.error
    || importLive2dMutation.error
    || resourcesQuery.error
    || bindingQuery.error;
  const errorMessage = error instanceof Error ? error.message : null;

  const disabledReason = !tauriReady
    ? t('Chat.avatarBindingTauriOnly', { defaultValue: 'Local avatar import requires the desktop runtime.' })
    : !agentId
      ? t('Chat.avatarBindingAgentRequired', { defaultValue: 'Select an agent target to manage local avatar binding.' })
      : null;

  return (
    <section
      className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,var(--nimi-surface-panel))] p-4"
      data-testid="agent-avatar-binding-settings"
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('Chat.avatarBindingTitle', { defaultValue: 'Avatar' })}
          </h3>
          {currentResource ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-status-success)]">
              {describeResourceKind(currentResource.kind)}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {t('Chat.avatarBindingDescription', {
            defaultValue: 'Import a local VRM or Live2D asset for this desktop only. Local binding overrides runtime presentation in the right rail.',
          })}
        </p>
      </div>

      {disabledReason ? (
        <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
          {disabledReason}
        </div>
      ) : null}

      {currentResource ? (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-success)_20%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_5%,var(--nimi-surface-card))] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{currentResource.displayName}</p>
              <p className="mt-1 text-[11px] text-[var(--nimi-text-muted)]">
                {t('Chat.avatarBindingCurrentLabel', {
                  defaultValue: 'Bound locally to {{name}}',
                  name: props.agentName || t('Chat.agentLabel', { defaultValue: 'this agent' }),
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFeedback(null);
                clearBindingMutation.mutate();
              }}
              disabled={pending}
              className="rounded-lg border border-[var(--nimi-border-subtle)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:text-[var(--nimi-action-primary-bg)] disabled:opacity-50"
            >
              {t('Chat.avatarBindingClear', { defaultValue: 'Clear' })}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
          {t('Chat.avatarBindingEmpty', { defaultValue: 'No local VRM or Live2D resource is bound to this agent yet.' })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setFeedback(null);
            importVrmMutation.mutate();
          }}
          disabled={Boolean(disabledReason) || pending}
          className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t('Chat.avatarBindingImportVrm', { defaultValue: 'Import VRM' })}
        </button>
        <button
          type="button"
          onClick={() => {
            setFeedback(null);
            importLive2dMutation.mutate();
          }}
          disabled={Boolean(disabledReason) || pending}
          className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 py-2 text-xs font-semibold text-[var(--nimi-text-primary)] transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:text-[var(--nimi-action-primary-bg)] disabled:opacity-50"
        >
          {t('Chat.avatarBindingImportLive2d', { defaultValue: 'Import Live2D' })}
        </button>
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

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
            {t('Chat.avatarBindingLibraryTitle', { defaultValue: 'Local Avatar Library' })}
          </p>
          {resourcesQuery.isFetching ? (
            <span className="text-[10px] text-[var(--nimi-text-muted)]">
              {t('Chat.settingsLoading', { defaultValue: 'Loading...' })}
            </span>
          ) : null}
        </div>
        {resources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
            {t('Chat.avatarBindingLibraryEmpty', { defaultValue: 'Imported avatar resources will appear here.' })}
          </div>
        ) : (
          <div className="space-y-2">
            {resources.map((resource) => {
              const bound = resource.resourceId === currentResource?.resourceId;
              return (
                <div
                  key={resource.resourceId}
                  className="rounded-xl border border-[var(--nimi-border-subtle)] bg-white px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">
                        {resource.displayName}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--nimi-text-muted)]">
                        {describeResourceKind(resource.kind)} · {describeResourceStatus(resource.status)}
                      </p>
                    </div>
                    {bound ? (
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--nimi-status-success)]">
                        {t('Chat.avatarBindingBoundLabel', { defaultValue: 'Bound' })}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!bound ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFeedback(null);
                          bindMutation.mutate(resource.resourceId);
                        }}
                        disabled={pending || Boolean(disabledReason)}
                        className="rounded-lg border border-[var(--nimi-border-subtle)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--nimi-text-secondary)] transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:text-[var(--nimi-action-primary-bg)] disabled:opacity-50"
                      >
                        {t('Chat.avatarBindingUseForAgent', { defaultValue: 'Use for this agent' })}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={async () => {
                        const confirmed = await confirmDialog({
                          title: t('Chat.avatarBindingDeleteConfirmTitle', { defaultValue: 'Remove local avatar resource?' }),
                          description: t('Chat.avatarBindingDeleteConfirmBody', {
                            defaultValue: 'This removes the imported avatar asset from local desktop storage. Existing bindings will be cleared.',
                          }),
                          level: 'warning',
                        });
                        if (!confirmed.confirmed) {
                          return;
                        }
                        setFeedback(null);
                        deleteResourceMutation.mutate(resource.resourceId);
                      }}
                      disabled={pending}
                      className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--nimi-status-danger)] transition-opacity hover:opacity-80 disabled:opacity-50"
                    >
                      {t('Chat.avatarBindingDelete', { defaultValue: 'Delete' })}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-[var(--nimi-text-muted)]">
        {t('Chat.avatarBindingFootnote', {
          defaultValue: 'Live2D resources are stored and bound locally now. Until a Live2D viewport lands, the rail will continue falling back when it cannot render that backend.',
        })}
      </p>
    </section>
  );
}
