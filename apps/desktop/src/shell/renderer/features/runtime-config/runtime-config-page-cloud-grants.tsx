import { useState } from 'react';
import type { TFunction } from 'i18next';
import type { NimiRuntimeConnectorGrant } from '@nimiplatform/sdk/runtime';
import type { ApiConnector } from './runtime-config-state-types.js';
import { Button } from './runtime-config-page-cloud-primitives.js';

type CloudConnectorGrantPanelProps = {
  readonly authenticated: boolean;
  readonly busyGrantId: string;
  readonly connectors: readonly ApiConnector[];
  readonly grants: readonly NimiRuntimeConnectorGrant[];
  readonly loading: boolean;
  readonly onRevoke: (grantId: string) => Promise<void>;
  readonly t: TFunction;
};

/** Account authorization lifecycle; this panel never projects routing or target choices. */
export function CloudConnectorGrantPanel(props: CloudConnectorGrantPanelProps) {
  const [confirmGrantId, setConfirmGrantId] = useState('');
  const activeCount = props.grants.filter((grant) => grant.status === 'active').length;

  return (
    <section className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4" data-runtime-connector-grants="true">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="m-0 text-sm font-semibold text-[var(--nimi-text-primary)]">
            {props.t('runtimeConfig.cloud.grants.title', { defaultValue: 'Account authorizations' })}
          </h3>
          <p className="m-0 mt-1 text-xs leading-relaxed text-[var(--nimi-text-muted)]">
            {props.t('runtimeConfig.cloud.grants.description', {
              defaultValue: 'A ConnectorGrant authorizes an account. It never selects a provider-model target or controls routing.',
            })}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--nimi-action-primary-bg)]">
          {props.t('runtimeConfig.cloud.grants.activeCount', {
            defaultValue: '{{count}} active',
            count: activeCount,
          })}
        </span>
      </div>

      {!props.authenticated ? (
        <div className="mt-3 rounded-xl bg-[var(--nimi-status-info-soft-bg)] p-3 text-xs text-[var(--nimi-status-info-soft-text)]">
          {props.t('runtimeConfig.cloud.grants.signInRequired', {
            defaultValue: 'Sign in to list and revoke account authorizations.',
          })}
        </div>
      ) : props.loading ? (
        <div className="mt-3 text-xs text-[var(--nimi-text-muted)]">
          {props.t('runtimeConfig.cloud.grants.loading', { defaultValue: 'Loading account authorizations…' })}
        </div>
      ) : props.grants.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] p-3 text-xs text-[var(--nimi-text-muted)]">
          {props.t('runtimeConfig.cloud.grants.empty', { defaultValue: 'No account authorizations have been created.' })}
        </div>
      ) : (
        <div className="mt-3 divide-y divide-[var(--nimi-border-subtle)]">
          {props.grants.map((grant) => {
            const connector = props.connectors.find((item) => item.id === grant.connectorId);
            const busy = props.busyGrantId === grant.grantId;
            const confirming = confirmGrantId === grant.grantId;
            return (
              <div className="flex min-w-0 items-center justify-between gap-3 py-3" key={grant.grantId}>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">
                      {connector?.label || grant.connectorId}
                    </span>
                    <span className={grant.status === 'active'
                      ? 'rounded-full bg-[var(--nimi-status-success-soft-bg)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-status-success-soft-text)]'
                      : 'rounded-full bg-[var(--nimi-status-neutral-soft-bg)] px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-semibold text-[var(--nimi-status-neutral-soft-text)]'}
                    >
                      {grant.status === 'active'
                        ? props.t('runtimeConfig.cloud.grants.active', { defaultValue: 'Active' })
                        : props.t('runtimeConfig.cloud.grants.revoked', { defaultValue: 'Revoked' })}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">{grant.grantId}</div>
                  <div className="mt-0.5 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
                    {props.t('runtimeConfig.cloud.grants.createdAt', {
                      defaultValue: 'Created {{timestamp}}',
                      timestamp: grant.createdAt,
                    })}
                  </div>
                </div>
                {grant.status === 'active' ? (
                  <div className="flex shrink-0 gap-2">
                    {confirming ? (
                      <>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            void props.onRevoke(grant.grantId).then(() => setConfirmGrantId(''));
                          }}
                          size="sm"
                          variant="danger"
                        >
                          {busy
                            ? props.t('runtimeConfig.cloud.grants.revoking', { defaultValue: 'Revoking…' })
                            : props.t('runtimeConfig.cloud.grants.confirmRevoke', { defaultValue: 'Confirm revoke' })}
                        </Button>
                        <Button disabled={busy} onClick={() => setConfirmGrantId('')} size="sm" variant="ghost">
                          {props.t('runtimeConfig.cloud.grants.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                      </>
                    ) : (
                      <Button onClick={() => setConfirmGrantId(grant.grantId)} size="sm" variant="danger">
                        {props.t('runtimeConfig.cloud.grants.revoke', { defaultValue: 'Revoke' })}
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
