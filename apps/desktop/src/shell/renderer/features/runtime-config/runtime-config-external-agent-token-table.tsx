import type { NimiExternalAgentTokenLedgerRecord } from '@nimiplatform/sdk/runtime';
import { cn } from '@nimiplatform/kit/ui';
import {
  ChevronIcon,
  ClockIcon,
  STATUS_TONE,
  ServiceIcon,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
  UserIcon,
  relativeFromNow,
  resolveTokenStatus,
} from './runtime-config-external-agent-access-model';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function ExternalAgentTokenTable(props: {
  canIssue: boolean;
  busy: boolean;
  errorMessage: string;
  expandedTokenId: string;
  filteredTokens: readonly NimiExternalAgentTokenLedgerRecord[];
  onExpandedTokenIdChange: (tokenId: string) => void;
  onRevokeToken: (tokenId: string) => void;
  showIssueForm: boolean;
  t: Translate;
  tokenCount: number;
}) {
  const t = props.t;
  return (
    <div className="mt-5">
      {props.filteredTokens.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] py-10 text-center">
          <p className={cn('text-sm', TOKEN_TEXT_SECONDARY)}>
            {props.tokenCount === 0
              ? t('runtimeConfig.eaa.noTokensIssued', { defaultValue: 'No tokens issued.' })
              : t('runtimeConfig.eaa.noTokensInFilter', { defaultValue: 'No tokens match this filter.' })}
          </p>
          {props.tokenCount === 0 ? (
            <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>
              {props.canIssue
                ? t('runtimeConfig.eaa.noTokensIssuedHint', { defaultValue: 'Issue a token to let an external agent call the runtime.' })
                : t('runtimeConfig.eaa.noTokensIssuedDeferredHint', { defaultValue: 'Tokens will appear here after Runtime enables the External Agent action plane.' })}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className={cn('grid grid-cols-[1.4fr_0.8fr_2fr_0.9fr_0.9fr_0.6fr] items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
            <span>{t('runtimeConfig.eaa.columnPrincipal', { defaultValue: 'Principal' })}</span>
            <span>{t('runtimeConfig.eaa.columnMode', { defaultValue: 'Mode' })}</span>
            <span>{t('runtimeConfig.eaa.columnScopes', { defaultValue: 'Scopes' })}</span>
            <span>{t('runtimeConfig.eaa.columnExpires', { defaultValue: 'Expires' })}</span>
            <span>{t('runtimeConfig.eaa.columnIssued', { defaultValue: 'Issued' })}</span>
            <span className="text-right">{t('runtimeConfig.eaa.columnActions', { defaultValue: '' })}</span>
          </div>

          <div className="divide-y divide-[var(--nimi-border-subtle)]/60">
            {props.filteredTokens.map((token) => (
              <ExternalAgentTokenRow
                key={token.tokenId}
                busy={props.busy}
                canIssue={props.canIssue}
                expanded={props.expandedTokenId === token.tokenId}
                onExpandedChange={(expanded) => props.onExpandedTokenIdChange(expanded ? token.tokenId : '')}
                onRevokeToken={() => props.onRevokeToken(token.tokenId)}
                t={t}
                token={token}
              />
            ))}
          </div>
        </>
      )}

      {props.errorMessage && !props.showIssueForm ? (
        <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{props.errorMessage}</p>
      ) : null}
    </div>
  );
}

function ExternalAgentTokenRow(props: {
  busy: boolean;
  canIssue: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onRevokeToken: () => void;
  t: Translate;
  token: NimiExternalAgentTokenLedgerRecord;
}) {
  const { token, t } = props;
  const bindings = useDesktopRendererBindings();
  const nowMs = bindings.clock.now();
  const status = resolveTokenStatus(token, nowMs);
  const tone = STATUS_TONE[status];
  const expiresRel = relativeFromNow(token.expiresAt, t, nowMs);
  const issuedRel = relativeFromNow(token.issuedAt, t, nowMs);
  const isService = !!token.subjectAccountId && token.subjectAccountId.startsWith('service_');
  const displayScopes = token.actions.length > 0
    ? token.actions
    : token.scopes.map((scope) => scope.actionId);
  const visibleScopes = displayScopes.slice(0, 3);
  const overflowCount = displayScopes.length - visibleScopes.length;
  const revokeDisabled = props.busy || !props.canIssue;
  const invokeRevoke = () => {
    if (revokeDisabled) {
      return;
    }
    props.onRevokeToken();
  };

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => props.onExpandedChange(!props.expanded)}
        className="grid w-full grid-cols-[1.4fr_0.8fr_2fr_0.9fr_0.9fr_0.6fr] items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-[var(--nimi-surface-panel)]/50"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            isService
              ? 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] text-[var(--nimi-text-secondary)]'
              : 'bg-[color-mix(in_srgb,var(--nimi-status-info,var(--nimi-text-secondary))_14%,transparent)] text-[var(--nimi-text-secondary)]',
          )}>
            {isService ? <ServiceIcon /> : <UserIcon />}
          </span>
          <div className="min-w-0">
            <p className={cn('truncate text-sm font-medium', TOKEN_TEXT_PRIMARY)}>
              {token.principalId}
            </p>
            <p className={cn('truncate font-mono text-[11px]', TOKEN_TEXT_MUTED)}>
              {token.subjectAccountId || '—'}
            </p>
          </div>
        </div>

        <div>
          <span className={cn(
            'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
            token.mode === 'autonomous'
              ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]'
              : 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_16%,transparent)] text-[var(--nimi-text-secondary)]',
          )}>
            {token.mode}
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {visibleScopes.length === 0 ? (
            <span className={cn('font-mono text-[11px]', TOKEN_TEXT_MUTED)}>—</span>
          ) : (
            visibleScopes.map((scope) => (
              <span
                key={`${token.tokenId}-${scope}`}
                className="rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/70 px-1.5 py-0.5 font-mono text-[11px] text-[var(--nimi-text-secondary)]"
              >
                {scope}
              </span>
            ))
          )}
          {overflowCount > 0 ? (
            <span className={cn('font-mono text-[11px]', TOKEN_TEXT_MUTED)}>
              +{overflowCount}
            </span>
          ) : null}
        </div>

        <div>
          {status === 'revoked' ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--nimi-status-danger)]">
              {t('runtimeConfig.eaa.tokenStatusRevoked', { defaultValue: 'revoked' })}
            </span>
          ) : (
            <span className={cn(
              'inline-flex items-center gap-1 text-[11px]',
              tone === 'success' ? 'text-[var(--nimi-status-success)]' : 'text-[var(--nimi-status-warning)]',
            )}>
              <ClockIcon />
              {expiresRel}
            </span>
          )}
        </div>

        <div className={cn('text-[11px]', TOKEN_TEXT_MUTED)}>
          {issuedRel}
        </div>

        <div className="flex items-center justify-end gap-1.5">
          {status !== 'revoked' ? (
            <span
              role="button"
              aria-disabled={revokeDisabled}
              tabIndex={revokeDisabled ? -1 : 0}
              onClick={(event) => {
                event.stopPropagation();
                invokeRevoke();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  invokeRevoke();
                }
              }}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                revokeDisabled
                  ? 'cursor-not-allowed text-[color-mix(in_srgb,var(--nimi-text-muted)_70%,transparent)]'
                  : 'text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] hover:text-[var(--nimi-status-danger)]',
              )}
            >
              {t('runtimeConfig.eaa.revoke', { defaultValue: 'Revoke' })}
            </span>
          ) : null}
          <span className={cn('text-[var(--nimi-text-muted)] transition-colors group-hover:text-[var(--nimi-text-primary)]')}>
            <ChevronIcon expanded={props.expanded} />
          </span>
        </div>
      </button>

      {props.expanded ? (
        <ExternalAgentTokenExpandedDetails
          displayScopes={displayScopes}
          t={t}
          token={token}
        />
      ) : null}
    </div>
  );
}

function ExternalAgentTokenExpandedDetails(props: {
  displayScopes: readonly string[];
  t: Translate;
  token: NimiExternalAgentTokenLedgerRecord;
}) {
  const { token, t } = props;
  return (
    <div className="mx-2 mb-3 mt-1 rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40 p-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[11px] sm:grid-cols-2">
        <div className="min-w-0">
          <dt className={cn('font-semibold uppercase tracking-[0.14em] text-[10px]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.eaa.tokenIdLabel', { defaultValue: 'tokenId' })}
          </dt>
          <dd className={cn('mt-0.5 truncate font-mono', TOKEN_TEXT_PRIMARY)} title={token.tokenId}>
            {token.tokenId}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={cn('font-semibold uppercase tracking-[0.14em] text-[10px]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.eaa.issuerLabel', { defaultValue: 'Issuer' })}
          </dt>
          <dd className={cn('mt-0.5 truncate font-mono', TOKEN_TEXT_PRIMARY)}>
            {token.issuer || '—'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={cn('font-semibold uppercase tracking-[0.14em] text-[10px]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.eaa.issuedAtLabel', { defaultValue: 'Issued at' })}
          </dt>
          <dd className={cn('mt-0.5 font-mono', TOKEN_TEXT_PRIMARY)}>
            {token.issuedAt || '—'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className={cn('font-semibold uppercase tracking-[0.14em] text-[10px]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.eaa.expiresAtLabel', { defaultValue: 'Expires at' })}
          </dt>
          <dd className={cn('mt-0.5 font-mono', TOKEN_TEXT_PRIMARY)}>
            {token.expiresAt || '—'}
          </dd>
        </div>
        {token.revokedAt ? (
          <div className="min-w-0">
            <dt className={cn('font-semibold uppercase tracking-[0.14em] text-[10px]', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.eaa.revokedAtLabel', { defaultValue: 'Revoked at' })}
            </dt>
            <dd className={cn('mt-0.5 font-mono', 'text-[var(--nimi-status-danger)]')}>
              {token.revokedAt}
            </dd>
          </div>
        ) : null}
        <div className="min-w-0 sm:col-span-2">
          <dt className={cn('font-semibold uppercase tracking-[0.14em] text-[10px]', TOKEN_TEXT_MUTED)}>
            {t('runtimeConfig.eaa.allScopesLabel', { defaultValue: 'All scopes' })}
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {props.displayScopes.length === 0 ? (
              <span className={cn('font-mono', TOKEN_TEXT_MUTED)}>—</span>
            ) : (
              props.displayScopes.map((scope) => (
                <span
                  key={`${token.tokenId}-expand-${scope}`}
                  className="rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--nimi-text-secondary)]"
                >
                  {scope}
                </span>
              ))
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
