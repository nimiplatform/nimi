import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import {
  DESKTOP_AGENT_PERMISSION_IDS,
  DESKTOP_AGENT_PERMISSION_I18N_SEGMENTS,
  isDesktopDependentAgentPermission,
  type DesktopAgentPermissionId,
  type DesktopLocalAppPermissionPosture,
  type DesktopLocalAppPermissionProjection,
} from './local-app-permission-owner.js';

export interface LocalAppPermissionSettingsItem {
  readonly permissionId: DesktopAgentPermissionId;
  readonly posture: DesktopLocalAppPermissionPosture;
  readonly effective: boolean;
  readonly currentAgentNames: readonly string[];
}

export interface LocalAppPermissionSettingsViewProps {
  readonly items: readonly LocalAppPermissionSettingsItem[];
  readonly loading: boolean;
  readonly error: string;
  readonly confirmingPermissionId: DesktopAgentPermissionId | null;
  readonly busyPermissionId: DesktopAgentPermissionId | null;
  readonly onRefresh: () => void;
  readonly onBeginRevoke: (permissionId: DesktopAgentPermissionId) => void;
  readonly onCancelRevoke: () => void;
  readonly onConfirmRevoke: (permissionId: DesktopAgentPermissionId) => void;
}

export function projectLocalAppPermissionSettingsItems(
  projections: readonly DesktopLocalAppPermissionProjection[],
): readonly LocalAppPermissionSettingsItem[] {
  const interactGranted = projections.some((projection) => (
    projection.permissionId === 'agents.interact' && projection.posture === 'granted'
  ));
  const order = new Map(DESKTOP_AGENT_PERMISSION_IDS.map((permissionId, index) => [permissionId, index]));
  return projections
    .filter((projection) => projection.posture === 'granted')
    .sort((left, right) => (
      (order.get(left.permissionId) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.permissionId) ?? Number.MAX_SAFE_INTEGER)
    ))
    .map((projection) => Object.freeze({
      permissionId: projection.permissionId,
      posture: projection.posture,
      effective: !isDesktopDependentAgentPermission(projection.permissionId) || interactGranted,
      currentAgentNames: projection.coveredAgents.map((agent) => agent.displayName),
    }));
}

export function LocalAppPermissionSettings({
  displayAppId,
}: {
  readonly displayAppId: string;
}): ReactElement {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [projections, setProjections] = useState<readonly DesktopLocalAppPermissionProjection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmingPermissionId, setConfirmingPermissionId] = useState<DesktopAgentPermissionId | null>(null);
  const [busyPermissionId, setBusyPermissionId] = useState<DesktopAgentPermissionId | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const matches = (await bindings.app.commands.localAppPermissions.listProjections())
        .filter((row) => row.displayAppId === displayAppId);
      const requestKeys = new Set(matches.map((row) => row.requestKey));
      if (requestKeys.size > 1) {
        throw new Error(t('AppPermissions.state.ambiguousOwner'));
      }
      setProjections(matches);
    } catch (cause) {
      setProjections([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [bindings.app.commands.localAppPermissions, displayAppId, t]);

  useEffect(() => {
    setConfirmingPermissionId(null);
    void refresh();
  }, [refresh]);

  const revoke = useCallback(async (permissionId: DesktopAgentPermissionId) => {
    const projection = projections.find((row) => row.permissionId === permissionId);
    if (!projection || projection.posture !== 'granted') {
      setError(t('AppPermissions.state.unsafeRevoke'));
      return;
    }
    setBusyPermissionId(permissionId);
    setError('');
    try {
      await bindings.app.commands.localAppPermissions.revoke({
        requestKey: projection.requestKey,
        permissionId,
      });
      setConfirmingPermissionId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyPermissionId(null);
    }
  }, [bindings.app.commands.localAppPermissions, projections, refresh, t]);

  const items = useMemo(() => projectLocalAppPermissionSettingsItems(projections), [projections]);

  return (
    <LocalAppPermissionSettingsView
      items={items}
      loading={loading}
      error={error}
      confirmingPermissionId={confirmingPermissionId}
      busyPermissionId={busyPermissionId}
      onRefresh={() => { void refresh(); }}
      onBeginRevoke={setConfirmingPermissionId}
      onCancelRevoke={() => setConfirmingPermissionId(null)}
      onConfirmRevoke={(permissionId) => { void revoke(permissionId); }}
    />
  );
}

export function LocalAppPermissionSettingsView({
  items,
  loading,
  error,
  confirmingPermissionId,
  busyPermissionId,
  onRefresh,
  onBeginRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: LocalAppPermissionSettingsViewProps): ReactElement {
  const { t } = useTranslation();
  return (
    <section
      data-testid="local-app-permission-settings"
      className="flex flex-col gap-3 border-t border-[color:var(--nimi-border-subtle)] pt-4"
      aria-busy={loading}
    >
      <div>
        <NimiText role="card-title">{t('AppPermissions.settings.title')}</NimiText>
        <NimiText role="helper" className="mt-1">
          {t('AppPermissions.settings.description')}
        </NimiText>
      </div>

      {items.map((item) => {
        const segment = DESKTOP_AGENT_PERMISSION_I18N_SEGMENTS[item.permissionId];
        const canRevoke = item.posture === 'granted';
        const confirming = confirmingPermissionId === item.permissionId;
        const dependent = isDesktopDependentAgentPermission(item.permissionId);
        const busy = busyPermissionId !== null;
        return (
          <Surface
            key={item.permissionId}
            tone="card"
            material="solid"
            padding="md"
            className="grid gap-2"
            data-testid={`local-app-permission-setting-${item.permissionId}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <NimiText role="body">{t(`AppPermissions.intent.${segment}`)}</NimiText>
                <NimiText role="helper" className="mt-1">
                  {t(`AppPermissions.intentDescription.${segment}`)}
                </NimiText>
              </div>
              <StatusBadge
                tone={postureTone(item.posture)}
                data-testid={`local-app-permission-posture-${item.permissionId}`}
                data-posture={item.posture}
              >
                {t(`AppPermissions.posture.${item.posture}`)}
              </StatusBadge>
            </div>

            {dependent ? (
              <InlineAlert tone={item.effective ? 'neutral' : 'warning'}>
                {t(item.effective
                  ? 'AppPermissions.dependency.interactRequired'
                  : 'AppPermissions.dependency.interactIneffective')}
              </InlineAlert>
            ) : null}

            {item.currentAgentNames.length > 0 ? (
              <div>
                <NimiText role="caption">{t('AppPermissions.settings.currentAgents')}</NimiText>
                <ul className="mt-1 list-disc pl-5 text-sm text-[var(--nimi-text-primary)]">
                  {item.currentAgentNames.map((name) => <li key={name}>{name}</li>)}
                </ul>
              </div>
            ) : item.permissionId === 'agents.interact' ? (
              <NimiText role="caption">
                {loading
                  ? t('AppPermissions.state.loading')
                  : t('AppPermissions.settings.noCurrentAgents')}
              </NimiText>
            ) : null}

            {canRevoke && confirming && item.permissionId === 'agents.interact' ? (
              <InlineAlert tone="warning" data-testid="local-app-permission-revoke-cascade">
                {t('AppPermissions.settings.interactCascadeWarning')}
              </InlineAlert>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {canRevoke && !confirming ? (
                <Button
                  data-testid={`local-app-permission-revoke-${item.permissionId}`}
                  tone="danger"
                  size="sm"
                  onClick={() => onBeginRevoke(item.permissionId)}
                  disabled={busy}
                >
                  {t('AppPermissions.action.revoke')}
                </Button>
              ) : null}
              {canRevoke && confirming ? (
                <>
                  <NimiText role="helper" className="mr-auto" aria-live="polite">
                    {t('AppPermissions.settings.revokeConfirm', {
                      permission: t(`AppPermissions.intent.${segment}`),
                    })}
                  </NimiText>
                  <Button tone="ghost" size="sm" onClick={onCancelRevoke} disabled={busy}>
                    {t('AppPermissions.action.cancel')}
                  </Button>
                  <Button
                    autoFocus
                    data-testid={`local-app-permission-revoke-confirm-${item.permissionId}`}
                    tone="danger"
                    size="sm"
                    loading={busyPermissionId === item.permissionId}
                    onClick={() => onConfirmRevoke(item.permissionId)}
                  >
                    {t('AppPermissions.action.confirmRevoke')}
                  </Button>
                </>
              ) : null}
            </div>
          </Surface>
        );
      })}

      {!loading && !error && items.length === 0 ? (
        <NimiText role="helper">{t('AppPermissions.settings.noPermissions')}</NimiText>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {error ? (
        <div className="flex justify-end">
          <Button tone="secondary" size="sm" onClick={onRefresh} disabled={busyPermissionId !== null}>
            {t('AppPermissions.action.retry')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function postureTone(posture: DesktopLocalAppPermissionPosture): 'success' | 'warning' | 'danger' | 'neutral' {
  if (posture === 'granted') return 'success';
  if (posture === 'pending' || posture === 'prompt') return 'warning';
  return 'neutral';
}
