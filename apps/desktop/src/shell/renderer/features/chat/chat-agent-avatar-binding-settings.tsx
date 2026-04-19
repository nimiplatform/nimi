import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
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
import {
  clearDesktopAgentBackdropBinding,
  desktopAgentBackdropBindingQueryKey,
  getDesktopAgentBackdropBinding,
  importDesktopAgentBackdrop,
  pickDesktopAgentBackdropImageSourcePath,
} from '@renderer/bridge/runtime-bridge/chat-agent-backdrop-store';
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

function ResourceKindGlyph(props: { kind: 'vrm' | 'live2d' }) {
  const label = props.kind === 'live2d' ? 'L' : 'V';
  const bgClass = props.kind === 'live2d'
    ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)] ring-1 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)]'
    : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_16%,var(--nimi-surface-card))] text-[var(--nimi-status-success)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]';
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold tracking-wider ${bgClass}`}
      aria-hidden="true"
    >
      {label}
    </span>
  );
}

function ResourceStatusDot(props: { status: 'ready' | 'invalid' | 'missing' }) {
  const statusClass = props.status === 'ready'
    ? 'bg-[var(--nimi-status-success)]'
    : props.status === 'missing'
      ? 'bg-[var(--nimi-status-warning)]'
      : 'bg-[var(--nimi-status-danger)]';
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusClass}`} aria-hidden="true" />;
}

function resolveBackdropPreviewImage(rawUrl: string | null | undefined): string | null {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) {
    return null;
  }
  try {
    const baseUrl =
      typeof window !== 'undefined' && typeof window.location?.href === 'string'
        ? window.location.href
        : 'https://nimi.invalid';
    const parsed = new URL(normalized, baseUrl);
    if (!['http:', 'https:', 'file:', 'asset:', 'blob:', 'data:'].includes(parsed.protocol)) {
      return null;
    }
    return `url(${JSON.stringify(parsed.toString())})`;
  } catch {
    return null;
  }
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
  const backdropBindingQuery = useQuery({
    queryKey: agentId ? desktopAgentBackdropBindingQueryKey(agentId) : ['desktop-agent-backdrop-binding', 'none'],
    queryFn: async () => (agentId ? getDesktopAgentBackdropBinding(agentId) : null),
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
      await queryClient.invalidateQueries({ queryKey: desktopAgentBackdropBindingQueryKey(agentId) });
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
  const importBackdropMutation = useMutation({
    mutationFn: async () => {
      const sourcePath = await pickDesktopAgentBackdropImageSourcePath();
      if (!sourcePath || !agentId) {
        return null;
      }
      return importDesktopAgentBackdrop({
        agentId,
        sourcePath,
        importedAtMs: Date.now(),
      });
    },
    onSuccess: async (result) => {
      if (!result) {
        return;
      }
      setFeedback(t('Chat.agentBackdropImportedFeedback', { defaultValue: 'Chat backdrop imported for this agent.' }));
      await refresh();
    },
  });
  const clearBackdropMutation = useMutation({
    mutationFn: async () => {
      if (!agentId) {
        throw new Error('Agent selection is required');
      }
      return clearDesktopAgentBackdropBinding(agentId);
    },
    onSuccess: async () => {
      setFeedback(t('Chat.agentBackdropClearedFeedback', { defaultValue: 'Chat backdrop cleared for this agent.' }));
      await refresh();
    },
  });

  const resources = (resourcesQuery.data || []).slice().sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  const pending = bindMutation.isPending
    || clearBindingMutation.isPending
    || deleteResourceMutation.isPending
    || importVrmMutation.isPending
    || importLive2dMutation.isPending
    || importBackdropMutation.isPending
    || clearBackdropMutation.isPending;
  const error = bindMutation.error
    || clearBindingMutation.error
    || deleteResourceMutation.error
    || importVrmMutation.error
    || importLive2dMutation.error
    || importBackdropMutation.error
    || clearBackdropMutation.error
    || resourcesQuery.error
    || bindingQuery.error
    || backdropBindingQuery.error;
  const errorMessage = error instanceof Error ? error.message : null;
  const currentBackdrop = backdropBindingQuery.data || null;
  const backdropPreviewImage = resolveBackdropPreviewImage(currentBackdrop?.fileUrl || null);

  const disabledReason = !tauriReady
    ? t('Chat.avatarBindingTauriOnly', { defaultValue: 'Local avatar import requires the desktop runtime.' })
    : !agentId
      ? t('Chat.avatarBindingAgentRequired', { defaultValue: 'Select an agent target to manage local avatar binding.' })
      : null;

  return (
    <section
      className="space-y-3 overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_94%,var(--nimi-surface-panel))] p-3 shadow-[0_10px_22px_rgba(15,23,42,0.04)]"
      data-testid="agent-avatar-binding-settings"
      data-chat-avatar-binding-surface="true"
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">
            {t('Chat.avatarBindingSectionHeading', { defaultValue: 'Local Avatar Binding' })}
          </h3>
          {currentResource ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-status-success)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]">
              {describeResourceKind(currentResource.kind)}
            </span>
          ) : null}
        </div>
        <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
          {t('Chat.avatarBindingDescription', {
            defaultValue: 'Import a local VRM or Live2D asset for this desktop only. Local binding overrides runtime presentation in the inline chat avatar stage.',
          })}
        </p>
      </div>

      {disabledReason ? (
        <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
          {disabledReason}
        </div>
      ) : null}

      {currentResource ? (
        <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-success)_20%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_5%,var(--nimi-surface-card))] px-3 py-2.5">
          <ResourceKindGlyph kind={currentResource.kind} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[var(--nimi-text-primary)]">{currentResource.displayName}</p>
            <p className="mt-0.5 truncate text-[11px] text-[var(--nimi-text-muted)]">
              {t('Chat.avatarBindingCurrentLabel', {
                defaultValue: 'Bound locally to {{name}}',
                name: props.agentName || t('Chat.agentLabel', { defaultValue: 'this agent' }),
              })}
            </p>
          </div>
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              setFeedback(null);
              clearBindingMutation.mutate();
            }}
            disabled={pending}
          >
            {t('Chat.avatarBindingClear', { defaultValue: 'Clear' })}
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
          {t('Chat.avatarBindingEmpty', { defaultValue: 'No local VRM or Live2D resource is bound to this agent yet.' })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          tone="primary"
          size="sm"
          onClick={() => {
            setFeedback(null);
            importVrmMutation.mutate();
          }}
          disabled={Boolean(disabledReason) || pending}
        >
          {t('Chat.avatarBindingImportVrm', { defaultValue: 'Import VRM' })}
        </Button>
        <Button
          tone="secondary"
          size="sm"
          onClick={() => {
            setFeedback(null);
            importLive2dMutation.mutate();
          }}
          disabled={Boolean(disabledReason) || pending}
        >
          {t('Chat.avatarBindingImportLive2d', { defaultValue: 'Import Live2D' })}
        </Button>
      </div>

      <div className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_92%,white)] p-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-primary)]">
              {t('Chat.agentBackdropHeading', { defaultValue: 'Chat Backdrop' })}
            </h4>
            {currentBackdrop ? (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--nimi-action-primary-bg)] ring-1 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)]">
                {t('Chat.agentBackdropBoundLabel', { defaultValue: 'Active' })}
              </span>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
            {t('Chat.agentBackdropDescription', {
              defaultValue: 'Import one desktop-local image to sit under the chat glass surface for this agent. The transcript stays above it; the backdrop is scene atmosphere only.',
            })}
          </p>
        </div>

        {currentBackdrop ? (
          <div className="space-y-3">
            <div
              className="overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,250,252,0.92))]"
              data-chat-agent-backdrop-preview="true"
            >
              <div
                className="h-28 w-full bg-cover bg-center"
                style={backdropPreviewImage
                  ? { backgroundImage: `linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.52)), ${backdropPreviewImage}` }
                  : undefined}
              />
              <div className="space-y-1 px-3 py-2.5">
                <p className="truncate text-[13px] font-semibold text-[var(--nimi-text-primary)]">
                  {currentBackdrop.displayName}
                </p>
                <p className="truncate text-[11px] text-[var(--nimi-text-muted)]">
                  {currentBackdrop.sourceFilename}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                tone="secondary"
                size="sm"
                onClick={() => {
                  setFeedback(null);
                  importBackdropMutation.mutate();
                }}
                disabled={Boolean(disabledReason) || pending}
              >
                {t('Chat.agentBackdropReplace', { defaultValue: 'Replace Image' })}
              </Button>
              <Button
                tone="ghost"
                size="sm"
                onClick={() => {
                  setFeedback(null);
                  clearBackdropMutation.mutate();
                }}
                disabled={Boolean(disabledReason) || pending}
              >
                {t('Chat.agentBackdropClear', { defaultValue: 'Clear' })}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
              {t('Chat.agentBackdropEmpty', { defaultValue: 'No local chat backdrop is bound to this agent yet.' })}
            </div>
            <Button
              tone="secondary"
              size="sm"
              onClick={() => {
                setFeedback(null);
                importBackdropMutation.mutate();
              }}
              disabled={Boolean(disabledReason) || pending}
            >
              {t('Chat.agentBackdropImport', { defaultValue: 'Import Backdrop Image' })}
            </Button>
          </div>
        )}
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
          <ul
            className="divide-y divide-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)] overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-white"
            role="listbox"
            aria-label={t('Chat.avatarBindingLibraryTitle', { defaultValue: 'Local Avatar Library' })}
          >
            {resources.map((resource) => {
              const bound = resource.resourceId === currentResource?.resourceId;
              const selectDisabled = pending || Boolean(disabledReason) || bound;
              return (
                <li
                  key={resource.resourceId}
                  className="relative"
                  data-chat-avatar-library-item={resource.resourceId}
                  data-chat-avatar-library-bound={bound ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={bound}
                    onClick={() => {
                      if (selectDisabled) {
                        return;
                      }
                      setFeedback(null);
                      bindMutation.mutate(resource.resourceId);
                    }}
                    disabled={selectDisabled}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 pr-10 text-left transition-colors disabled:cursor-default ${
                      bound
                        ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_6%,transparent)]'
                        : 'hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)]'
                    }`}
                  >
                    <ResourceKindGlyph kind={resource.kind} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-[13px] font-semibold text-[var(--nimi-text-primary)]">
                          {resource.displayName}
                        </p>
                        {bound ? (
                          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--nimi-status-success)]">
                            {t('Chat.avatarBindingBoundLabel', { defaultValue: 'Bound' })}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--nimi-text-muted)]">
                        <ResourceStatusDot status={resource.status} />
                        <span>{describeResourceKind(resource.kind)}</span>
                        <span className="text-[var(--nimi-text-muted)]/60">·</span>
                        <span>{describeResourceStatus(resource.status)}</span>
                      </p>
                    </div>
                    {bound ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-[var(--nimi-status-success)]"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : null}
                  </button>
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
                    aria-label={t('Chat.avatarBindingDelete', { defaultValue: 'Delete' })}
                    title={t('Chat.avatarBindingDelete', { defaultValue: 'Delete' })}
                    className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--nimi-text-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] hover:text-[var(--nimi-status-danger)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-[var(--nimi-text-muted)]">
        {t('Chat.avatarBindingFootnote', {
          defaultValue: 'Live2D resources are stored and bound locally now. Until a Live2D viewport lands, the inline avatar stage will continue falling back when it cannot render that backend.',
        })}
      </p>
    </section>
  );
}
