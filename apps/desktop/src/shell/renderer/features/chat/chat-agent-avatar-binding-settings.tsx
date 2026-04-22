import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
import {
  clearDesktopAgentBackdropBinding,
  desktopAgentBackdropBindingQueryKey,
  getDesktopAgentBackdropBinding,
  importDesktopAgentBackdrop,
  pickDesktopAgentBackdropImageSourcePath,
} from '@renderer/bridge/runtime-bridge/chat-agent-backdrop-store';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';

type ChatAgentAvatarBindingSettingsProps = {
  agentId: string | null;
  agentName: string | null;
};

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

  const backdropBindingQuery = useQuery({
    queryKey: agentId ? desktopAgentBackdropBindingQueryKey(agentId) : ['desktop-agent-backdrop-binding', 'none'],
    queryFn: async () => (agentId ? getDesktopAgentBackdropBinding(agentId) : null),
    enabled: tauriReady && Boolean(agentId),
    staleTime: 30_000,
  });

  const refresh = async () => {
    if (agentId) {
      await queryClient.invalidateQueries({ queryKey: desktopAgentBackdropBindingQueryKey(agentId) });
    }
  };

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

  const pending = importBackdropMutation.isPending || clearBackdropMutation.isPending;
  const error = importBackdropMutation.error || clearBackdropMutation.error || backdropBindingQuery.error;
  const errorMessage = error instanceof Error ? error.message : null;
  const currentBackdrop = backdropBindingQuery.data || null;
  const backdropPreviewImage = resolveBackdropPreviewImage(currentBackdrop?.fileUrl || null);

  const disabledReason = !tauriReady
    ? t('Chat.avatarBindingTauriOnly', { defaultValue: 'Desktop shell controls require the desktop runtime.' })
    : !agentId
      ? t('Chat.avatarBindingAgentRequired', { defaultValue: 'Select an agent target to manage this shell surface.' })
      : null;

  return (
    <section
      className="space-y-3 overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_94%,var(--nimi-surface-panel))] p-3 shadow-[0_10px_22px_rgba(15,23,42,0.04)]"
      data-testid="agent-avatar-binding-settings"
      data-chat-avatar-shell-settings="true"
    >
      <div className="space-y-1.5">
        <h3 className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">
          {t('Chat.avatarBindingSectionHeading', { defaultValue: 'Avatar App' })}
        </h3>
        <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">
          {t('Chat.avatarBindingDescription', {
            defaultValue: 'Desktop no longer imports, binds, or renders local VRM/Live2D avatars. Launch Nimi Avatar for carrier execution; this panel only keeps shell-owned backdrop settings.',
          })}
        </p>
        <p className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs leading-5 text-amber-800">
          {t('Chat.avatarBindingResidueNotice', {
            defaultValue: 'Wave 4 Exec Pack 4 decommissioned the desktop-local avatar carrier path. Missing avatar launch or handoff must fail closed instead of falling back to local desktop rendering.',
          })}
        </p>
        <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50/80 px-2.5 py-1 text-[11px] font-medium text-sky-700">
          <span>{t('Chat.avatarCarrierOwnerLabel', { defaultValue: 'Carrier owner' })}</span>
          <code>{t('Chat.avatarCarrierOwnerPath', { defaultValue: 'apps/avatar' })}</code>
        </div>
      </div>

      {disabledReason ? (
        <div className="rounded-xl border border-dashed border-[var(--nimi-border-subtle)] px-3 py-3 text-xs text-[var(--nimi-text-muted)]">
          {disabledReason}
        </div>
      ) : null}

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
          <p className="text-[11px] leading-5 text-[var(--nimi-text-muted)]">
            {t('Chat.agentBackdropScopeNotice', {
              defaultValue: 'Backdrop settings remain desktop shell scope. They do not recreate an avatar carrier path or override avatar-app presentation truth.',
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
                {props.agentName ? (
                  <p className="truncate text-[11px] text-[var(--nimi-text-muted)]">
                    {t('Chat.avatarBindingCurrentLabel', {
                      defaultValue: 'Bound locally to {{name}}',
                      name: props.agentName,
                    })}
                  </p>
                ) : null}
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
    </section>
  );
}
