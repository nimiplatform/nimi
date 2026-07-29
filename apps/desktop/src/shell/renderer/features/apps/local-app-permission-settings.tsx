import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type {
  DesktopLocalAppPermissionPosture,
  DesktopLocalAppPermissionProjection,
} from './local-app-permission-owner.js';

export interface LocalAppPermissionSettingsViewProps {
  readonly posture: DesktopLocalAppPermissionPosture;
  readonly currentAgentNames: readonly string[];
  readonly loading: boolean;
  readonly error: string;
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly onRefresh: () => void;
  readonly onBeginRevoke: () => void;
  readonly onCancelRevoke: () => void;
  readonly onConfirmRevoke: () => void;
}

export function LocalAppPermissionSettings({
  displayAppId,
}: {
  readonly displayAppId: string;
}): ReactElement {
  const bindings = useDesktopRendererBindings();
  const [projection, setProjection] = useState<DesktopLocalAppPermissionProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const matches = (await bindings.app.commands.localAppPermissions.listProjections())
        .filter((row) => row.displayAppId === displayAppId);
      if (matches.length > 1) {
        throw new Error('Permission ownership is ambiguous for this app.');
      }
      setProjection(matches[0] ?? null);
    } catch (cause) {
      setProjection(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [bindings.app.commands.localAppPermissions, displayAppId]);

  useEffect(() => {
    setConfirming(false);
    void refresh();
  }, [refresh]);

  const revoke = useCallback(async () => {
    if (!projection || projection.posture !== 'granted') {
      setError('Permission ownership cannot be safely revoked.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await bindings.app.commands.localAppPermissions.revoke({
        requestKey: projection.requestKey,
      });
      setProjection(next);
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [bindings.app.commands.localAppPermissions, projection]);

  return (
    <LocalAppPermissionSettingsView
      posture={error ? 'unavailable' : projection?.posture ?? 'prompt'}
      currentAgentNames={projection?.coveredAgents.map((agent) => agent.displayName) ?? []}
      loading={loading}
      error={error}
      confirming={confirming}
      busy={busy}
      onRefresh={() => { void refresh(); }}
      onBeginRevoke={() => setConfirming(true)}
      onCancelRevoke={() => setConfirming(false)}
      onConfirmRevoke={() => { void revoke(); }}
    />
  );
}

export function LocalAppPermissionSettingsView({
  posture,
  currentAgentNames,
  loading,
  error,
  confirming,
  busy,
  onRefresh,
  onBeginRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: LocalAppPermissionSettingsViewProps): ReactElement {
  const { t } = useTranslation();
  const canRevoke = posture === 'granted';
  return (
    <section
      data-testid="local-app-permission-settings"
      className="flex flex-col gap-3 border-t border-[color:var(--nimi-border-subtle)] pt-4"
      aria-busy={loading}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <NimiText role="card-title">
            {t('AppPermissions.settings.title', { defaultValue: 'App permissions' })}
          </NimiText>
          <NimiText role="helper" className="mt-1">
            {t('AppPermissions.settings.description', { defaultValue: 'Manage access to Nimi-owned capabilities.' })}
          </NimiText>
        </div>
        <StatusBadge tone={postureTone(posture)} data-testid="local-app-permission-posture" data-posture={posture}>
          {t(`AppPermissions.posture.${posture}`, { defaultValue: posture })}
        </StatusBadge>
      </div>

      <Surface tone="card" material="solid" padding="md" className="grid gap-2">
        <NimiText role="body">
          {t('AppPermissions.intent.agentsInteract', { defaultValue: 'Interact with all Agents in your account' })}
        </NimiText>
        <NimiText role="helper">
          {t('AppPermissions.scope.description', {
            defaultValue: 'Current and future Agents are included automatically. Revoking this permission removes access to all of them.',
          })}
        </NimiText>
        {currentAgentNames.length > 0 ? (
          <div>
            <NimiText role="caption">
              {t('AppPermissions.settings.currentAgents', { defaultValue: 'Agents currently covered' })}
            </NimiText>
            <ul className="mt-1 list-disc pl-5 text-sm text-[var(--nimi-text-primary)]">
              {currentAgentNames.map((name) => <li key={name}>{name}</li>)}
            </ul>
          </div>
        ) : (
          <NimiText role="caption">
            {loading
              ? t('AppPermissions.state.loading', { defaultValue: 'Loading…' })
              : t('AppPermissions.settings.noCurrentAgents', {
                defaultValue: 'No Agents exist in this account yet; future Agents are included automatically.',
              })}
          </NimiText>
        )}
      </Surface>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <Button tone="secondary" size="sm" onClick={onRefresh} disabled={busy}>
            {t('AppPermissions.action.retry', { defaultValue: 'Retry' })}
          </Button>
        ) : null}
        {canRevoke && !confirming ? (
          <Button data-testid="local-app-permission-revoke" tone="danger" size="sm" onClick={onBeginRevoke} disabled={busy}>
            {t('AppPermissions.action.revoke', { defaultValue: 'Revoke' })}
          </Button>
        ) : null}
        {canRevoke && confirming ? (
          <>
            <NimiText role="helper" className="mr-auto" aria-live="polite">
              {t('AppPermissions.settings.revokeConfirm', { defaultValue: 'Revoke access to all current and future Agents?' })}
            </NimiText>
            <Button tone="ghost" size="sm" onClick={onCancelRevoke} disabled={busy}>
              {t('AppPermissions.action.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button autoFocus data-testid="local-app-permission-revoke-confirm" tone="danger" size="sm" loading={busy} onClick={onConfirmRevoke}>
              {t('AppPermissions.action.confirmRevoke', { defaultValue: 'Confirm revoke' })}
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}

function postureTone(posture: DesktopLocalAppPermissionPosture): 'success' | 'warning' | 'danger' | 'neutral' {
  if (posture === 'granted') return 'success';
  if (posture === 'pending' || posture === 'prompt') return 'warning';
  if (posture === 'denied') return 'danger';
  return 'neutral';
}
