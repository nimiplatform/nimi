import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import type { AppCardActionId } from './apps-card-actions.js';
import {
  AppsAIConfigSection,
  appsAIConfigCapabilityContracts,
} from './apps-ai-config-section.js';
import { deriveIconGlyph } from './apps-card-fields.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

export interface AppsDetailViewProps {
  readonly entry: DesktopAppsEntry | null;
  readonly onCardAction: (appId: string, action: AppCardActionId) => void;
  readonly onClose: () => void;
}

export function AppsDetailView({ entry, onClose }: AppsDetailViewProps): ReactElement | null {
  const { t } = useTranslation();
  if (!entry) return null;

  const { registration } = entry;
  const aiConfigCapabilityContracts = appsAIConfigCapabilityContracts(registration.appAccess);
  return (
    <OverlayShell
      open
      kind="dialog"
      size="M"
      onClose={onClose}
      panelClassName="flex max-h-[calc(100vh-32px)] flex-col"
      contentClassName="min-h-0 flex-1 overflow-y-auto"
      title={
        <span data-testid="apps-detail-title" className="flex items-center gap-2">
          <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--nimi-surface-active)_70%,transparent)] text-xs font-semibold">
            {deriveIconGlyph(registration.displayName)}
          </span>
          {registration.displayName}
        </span>
      }
      footer={<Button tone="secondary" onClick={onClose}>{t('Apps.action.close')}</Button>}
    >
      <div data-testid="apps-detail-body" className="flex flex-col gap-4 text-sm">
        <dl className="flex flex-col gap-2">
          <DetailRow label={t('LocalDevelopment.field.app')} value={registration.appId} />
          <DetailRow
            label={t('LocalDevelopment.field.shell')}
            value={t(`LocalDevelopment.shell.${registration.shell}`, { defaultValue: registration.shell })}
          />
          <DetailRow label={t('LocalDevelopment.field.projectRoot')} value={registration.canonicalProjectRoot} />
          <DetailRow label={t('LocalDevelopment.field.sourceGeneration')} value={String(registration.sourceGeneration)} />
          <DetailRow label={t('LocalDevelopment.field.declarationGeneration')} value={String(registration.declarationGeneration)} />
        </dl>

        <div data-testid="apps-detail-app-access" className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-[color:var(--nimi-text-muted)]">
            {t('LocalDevelopment.field.appAccess')}
          </span>
          {registration.appAccess.length === 0 ? (
            <p className="text-xs leading-5 text-[color:var(--nimi-text-secondary)]">
              {t('LocalDevelopment.field.noAppAccess')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs text-[color:var(--nimi-text-secondary)]">
              {registration.appAccess.map((domain) => (
                <li key={domain} data-app-access={domain} className="font-mono">{domain}</li>
              ))}
            </ul>
          )}
        </div>

        {aiConfigCapabilityContracts.length > 0 ? (
          <div className="border-t border-[var(--nimi-border-subtle)] pt-4">
            <AppsAIConfigSection
              appId={registration.appId}
              appDisplayName={registration.displayName}
            />
          </div>
        ) : null}
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
