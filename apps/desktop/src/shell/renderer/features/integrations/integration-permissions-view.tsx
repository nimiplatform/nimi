import { Plus } from 'lucide-react';
import { Button } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import type {
  NimiIntegrationManagement,
  NimiIntegrationPermission,
  NimiIntegrationTarget,
} from '@nimiplatform/sdk/app';
import { AppArtworkIcon } from '../apps/apps-card-visuals.js';
import { integrationOperationPresentation } from './integration-operation-presentation.js';
import { IntegrationConsumerDetails } from './integration-consumer-details.js';

export function IntegrationPermissionsView({
  snapshot,
  target,
  appIconUrls,
  all = false,
  busy,
  onAdd,
  onEdit,
  onRevoke,
}: {
  appIconUrls?: ReadonlyMap<string, string | null>;
  snapshot: NimiIntegrationManagement;
  target?: NimiIntegrationTarget;
  all?: boolean;
  busy: boolean;
  onAdd: () => void;
  onEdit: (permission: NimiIntegrationPermission) => void;
  onRevoke: (permission: NimiIntegrationPermission) => void;
}) {
  const { t } = useTranslation();
  const permissions = snapshot.permissions.filter(
    (item) => item.operations.length && (all || item.targetRef === target?.targetRef),
  );
  return (
    <section data-testid="integration-permissions">
      {!all ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">{t('Integrations.authorizedApps')}</h2>
          {target ? (
            <Button
              tone="primary"
              size="sm"
              disabled={busy || !snapshot.consumers.length}
              leadingIcon={<Plus size={15} />}
              onClick={onAdd}
            >
              {t('Integrations.authorizeApp')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!all && !snapshot.consumers.length ? (
        <p className="mt-4 text-sm text-[var(--nimi-text-secondary)]">{t('Integrations.noEligibleApps')}</p>
      ) : null}
      {permissions.length ? (
        <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--nimi-border-subtle)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[color-mix(in_srgb,var(--nimi-surface-active)_45%,transparent)] text-xs text-[var(--nimi-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('Integrations.apps')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('Integrations.operations')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('Integrations.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission) => {
                const eligible = snapshot.consumers.find(
                  (item) => item.consumerRef === permission.consumerRef,
                );
                const app = eligible || permission.consumer || undefined;
                const source = snapshot.targets.find((item) => item.targetRef === permission.targetRef);
                return (
                  <tr
                    key={`${permission.consumerRef}/${permission.targetRef}`}
                    className="border-t border-[var(--nimi-border-subtle)] align-top"
                  >
                    <td className="min-w-48 px-4 py-5">
                      <div className="flex gap-3">
                        <AppArtworkIcon
                          appId={app?.appId || permission.consumerRef}
                          displayName={app?.displayName || app?.appId || t('Integrations.unavailableApp')}
                          iconUrl={app?.appId ? appIconUrls?.get(app.appId) : null}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <p className="font-medium">
                            {app?.displayName || app?.appId || t('Integrations.unavailableApp')}
                          </p>
                          <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">
                            {t(`Integrations.sourceKinds.${app?.sourceKind || 'unknown'}`)}
                          </p>
                          {all ? (
                            <p className="mt-1 text-xs">
                              {source?.displayName || t('Integrations.unavailableTarget')}
                              {source?.accountLabel && !source.displayName.includes(source.accountLabel)
                                ? ` · ${source.accountLabel}`
                                : ''}
                            </p>
                          ) : null}
                          {!eligible ? (
                            <p className="mt-1 max-w-72 text-xs text-[var(--nimi-text-muted)]">
                              {t('Integrations.unavailablePermissionConsumer')}
                            </p>
                          ) : null}
                          {source && !source.available ? (
                            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                              {t('Integrations.unavailablePermissionSource')}
                            </p>
                          ) : null}
                          <IntegrationConsumerDetails consumerRef={permission.consumerRef} />
                        </div>
                      </div>
                    </td>
                    <td className="max-w-md px-4 py-5">
                      <ul className="flex flex-wrap gap-2">
                        {permission.operations.map((name) => {
                          const op = source?.operations.find((item) => item.name === name);
                          return (
                            <li
                              key={name}
                              className="break-all rounded-md bg-[var(--nimi-surface-active)] px-2 py-0.5 text-xs text-[var(--nimi-text-secondary)]"
                            >
                              {source && op
                                ? integrationOperationPresentation(source.kind, op, t).name
                                : name}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                    <td className="px-4 py-5">
                      <div className="flex flex-wrap gap-2">
                        {eligible && source ? (
                          <Button
                            tone="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => onEdit(permission)}
                          >
                            {t('Integrations.editPermissions')}
                          </Button>
                        ) : null}
                        <Button tone="ghost" size="sm" disabled={busy} onClick={() => onRevoke(permission)}>
                          {t('Integrations.revoke')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-12 text-center text-sm text-[var(--nimi-text-secondary)]">
          {t('Integrations.noPermissions')}
        </p>
      )}
      <p className="mt-6 text-xs leading-5 text-[var(--nimi-text-muted)]">{t('Integrations.custody')}</p>
    </section>
  );
}
