import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import type { AppCardActionId } from './apps-card-actions.js';
import { deriveIconGlyph } from './apps-card-fields.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';
import { LocalAppPermissionSettings } from './local-app-permission-settings.js';

export interface AppsDetailViewProps {
  readonly entry: DesktopAppsEntry | null;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  readonly onClose: () => void;
}

export function AppsDetailView({
  entry,
  onClose,
}: AppsDetailViewProps): ReactElement | null {
  const { t } = useTranslation();
  if (!entry) return null;

  const { authorization } = entry;
  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={onClose}
      title={
        <span data-testid="apps-detail-title" className="flex items-center gap-2">
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)] text-xs font-semibold">
            {deriveIconGlyph(authorization.displayName)}
          </span>
          {authorization.displayName}
        </span>
      }
      footer={<Button tone="secondary" onClick={onClose}>{t('Apps.action.close')}</Button>}
    >
      <div data-testid="apps-detail-body" className="flex flex-col gap-4 text-sm">
        <dl className="flex flex-col gap-2">
          <DetailRow label={t('LocalDevelopment.field.app')} value={authorization.appId} />
          <DetailRow
            label={t('LocalDevelopment.field.shell')}
            value={t(`LocalDevelopment.shell.${authorization.shell}`, { defaultValue: authorization.shell })}
          />
          <DetailRow
            label={t('Apps.detail.openReadiness')}
            value={t(`LocalDevelopment.state.${authorization.state}`, { defaultValue: authorization.state })}
          />
          <DetailRow label={t('LocalDevelopment.field.projectRoot')} value={authorization.canonicalProjectRoot} />
        </dl>

        <div data-testid="apps-detail-permissions" className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-[color:var(--nimi-text-muted)]">
            {t('LocalDevelopment.field.permissions')}
          </span>
          {authorization.permissionRequirements.length === 0 ? (
            <p className="text-xs leading-5 text-[color:var(--nimi-text-secondary)]">
              {t('LocalDevelopment.field.noExtraPermissions')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs text-[color:var(--nimi-text-secondary)]">
              {authorization.permissionRequirements.map((requirement) => (
                <li key={requirement.permissionId} data-permission-id={requirement.permissionId}>
                  <span className="font-mono">{requirement.permissionId}</span>
                  {' · '}
                  {requirement.reason}
                </li>
              ))}
            </ul>
          )}
        </div>

        <LocalAppPermissionSettings displayAppId={authorization.appId} />
      </div>
    </OverlayShell>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[color:var(--nimi-text-muted)]">{label}</dt>
      <dd className="min-w-0 break-all text-right text-[color:var(--nimi-text-primary)]">{value}</dd>
    </div>
  );
}
