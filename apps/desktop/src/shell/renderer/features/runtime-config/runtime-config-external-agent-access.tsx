import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createNimiRuntimeExternalAgentAccessSurface,
  type NimiExternalAgentTokenLedgerRecord,
} from '@nimiplatform/sdk/runtime';
import { Surface, cn } from '@nimiplatform/kit/ui';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';
import { Button } from './runtime-config-primitives';
import {
  CheckIcon,
  CopyIcon,
  IconButton,
  PlusIcon,
  RefreshIcon,
  StatusDot,
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  resolveTokenStatus,
  type GatewayStatusParsed,
  type TokenFilter,
  type TokenMode,
} from './runtime-config-external-agent-access-model';
import { ExternalAgentIssueTokenForm } from './runtime-config-external-agent-issue-token-form';
import { ExternalAgentTokenTable } from './runtime-config-external-agent-token-table';

const externalAgentAccess = createNimiRuntimeExternalAgentAccessSurface({
  getExternalAgents: () => getDesktopRuntime().externalAgents,
});

export function ExternalAgentAccessPanel() {
  const { t } = useTranslation();
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusParsed>({
    enabled: false,
    loading: true,
    bindAddress: '',
    issuer: '',
    actionCount: null,
    status: undefined,
    reasonCode: undefined,
    errored: false,
  });
  const [principalId, setPrincipalId] = useState('openclaw.local');
  const [subjectAccountId, setSubjectAccountId] = useState('');
  const [mode, setMode] = useState<TokenMode>('delegated');
  const [actionsInput, setActionsInput] = useState('');
  const [ttlSeconds, setTtlSeconds] = useState('3600');
  const [tokenId, setTokenId] = useState('');
  const [issuedToken, setIssuedToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [tokens, setTokens] = useState<NimiExternalAgentTokenLedgerRecord[]>([]);
  const [copiedBindAddress, setCopiedBindAddress] = useState(false);
  const [filter, setFilter] = useState<TokenFilter>('all');
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [expandedTokenId, setExpandedTokenId] = useState<string>('');

  const ttlRaw = Number(ttlSeconds);
  const ttlIsPositiveInteger = /^\d+$/.test(ttlSeconds.trim()) && Number.isInteger(ttlRaw) && ttlRaw > 0;
  const ttlValidationMessage = ttlSeconds.trim() && !ttlIsPositiveInteger
    ? t('runtimeConfig.eaa.ttlPositiveInteger', { defaultValue: 'TTL must be a positive integer.' })
    : '';

  const refreshGateway = async () => {
    setRefreshing(true);
    try {
      const status = await externalAgentAccess.getGatewayStatus();
      const rows = await externalAgentAccess.listTokens();
      setGatewayStatus({
        enabled: Boolean(status.enabled),
        loading: false,
        bindAddress: status.bindAddress || '',
        issuer: status.issuer || '',
        actionCount: typeof status.actionCount === 'number' ? status.actionCount : null,
        status: status.status,
        reasonCode: status.reasonCode,
        errored: false,
      });
      setTokens([...rows]);
    } catch (error) {
      setGatewayStatus({
        enabled: false,
        loading: false,
        bindAddress: '',
        issuer: '',
        actionCount: null,
        status: 'failed',
        reasonCode: 'EXTERNAL_AGENT_GATEWAY_STATUS_FAILED',
        errored: true,
      });
      setTokens([]);
      setErrorMessage(error instanceof Error ? error.message : String(error || t('runtimeConfig.eaa.gatewayRefreshFailed', { defaultValue: 'Gateway refresh failed' })));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshGateway();
  }, []);

  const handleIssueToken = () => {
    void (async () => {
      setBusy(true);
      setErrorMessage('');
      try {
        if (!ttlIsPositiveInteger) {
          setErrorMessage(t('runtimeConfig.eaa.ttlPositiveInteger', { defaultValue: 'TTL must be a positive integer.' }));
          return;
        }
        const actions = actionsInput
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        if (actions.length === 0) {
          setErrorMessage(t('runtimeConfig.eaa.actionScopesRequired', { defaultValue: 'At least one action scope is required.' }));
          return;
        }
        const issued = await externalAgentAccess.issueToken({
          principalId,
          mode,
          subjectAccountId,
          actions,
          ttlSeconds: ttlRaw,
        });
        setIssuedToken(issued.token);
        setTokenId(issued.tokenId);
        await refreshGateway();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error || t('runtimeConfig.eaa.issueTokenFailed', { defaultValue: 'Issue token failed' })));
      } finally {
        setBusy(false);
      }
    })();
  };

  const handleRevokeToken = (targetTokenId?: string) => {
    void (async () => {
      const resolvedTokenId = String(targetTokenId || tokenId).trim();
      if (!resolvedTokenId) return;
      setBusy(true);
      setErrorMessage('');
      try {
        await externalAgentAccess.revokeToken(resolvedTokenId);
        setIssuedToken('');
        if (resolvedTokenId === tokenId) {
          setTokenId('');
        }
        await refreshGateway();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error || t('runtimeConfig.eaa.revokeTokenFailed', { defaultValue: 'Revoke token failed' })));
      } finally {
        setBusy(false);
      }
    })();
  };

  const onCopyBindAddress = () => {
    if (!gatewayStatus.enabled || !gatewayStatus.bindAddress) return;
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (!clip?.writeText) return;
    void clip.writeText(gatewayStatus.bindAddress).then(() => {
      setCopiedBindAddress(true);
      window.setTimeout(() => setCopiedBindAddress(false), 1500);
    }).catch(() => undefined);
  };

  const canIssue = gatewayStatus.enabled
    && !gatewayStatus.loading
    && (gatewayStatus.actionCount ?? 0) > 0;
  const isActionRegistryDeferred = gatewayStatus.reasonCode === 'EXTERNAL_AGENT_ACTION_REGISTRY_EMPTY';

  const tokenCounts = useMemo(() => {
    let active = 0;
    let revoked = 0;
    let expired = 0;
    for (const token of tokens) {
      const status = resolveTokenStatus(token);
      if (status === 'active') active += 1;
      else if (status === 'revoked') revoked += 1;
      else expired += 1;
    }
    return { active, revoked, expired, total: tokens.length };
  }, [tokens]);

  const filteredTokens = useMemo(() => {
    if (filter === 'all') return tokens;
    if (filter === 'active') {
      return tokens.filter((token) => resolveTokenStatus(token) === 'active');
    }
    return tokens.filter((token) => resolveTokenStatus(token) === 'revoked');
  }, [tokens, filter]);

  const gatewayHeadline = gatewayStatus.loading
    ? t('runtimeConfig.eaa.gatewayLoadingHeadline', { defaultValue: 'Checking gateway status' })
    : gatewayStatus.errored
      ? t('runtimeConfig.eaa.gatewayUnavailableHeadline', { defaultValue: 'Gateway unavailable' })
      : isActionRegistryDeferred
        ? t('runtimeConfig.eaa.gatewayDeferredHeadline', { defaultValue: 'External Agent access is deferred' })
        : gatewayStatus.enabled
          ? t('runtimeConfig.eaa.gatewayAcceptingHeadline', { defaultValue: 'Gateway is accepting connections' })
          : t('runtimeConfig.eaa.gatewayOfflineHeadline', { defaultValue: 'Gateway is offline' });

  const gatewaySubline = gatewayStatus.errored
    ? t('runtimeConfig.eaa.gatewayErrorSubline', { defaultValue: 'Unable to reach the local runtime gateway.' })
    : isActionRegistryDeferred
      ? t('runtimeConfig.eaa.gatewayActionRegistryEmptySubline', { defaultValue: 'Runtime projection is present, but token issuance stays disabled until the Runtime action registry and gateway server land.' })
      : gatewayStatus.enabled
        ? t('runtimeConfig.eaa.gatewayAcceptingSubline', { defaultValue: 'External agents can request tokens at the bind address below.' })
        : t('runtimeConfig.eaa.gatewayOfflineSubline', { defaultValue: 'Runtime is not accepting external agent connections.' });

  const headerDot: 'success' | 'warning' | 'danger' | 'muted' = gatewayStatus.loading
    ? 'muted'
    : gatewayStatus.errored
      ? 'danger'
      : gatewayStatus.enabled
        ? 'success'
        : 'warning';

  const meta = useMemo(() => [
    {
      key: 'bind',
      label: t('runtimeConfig.eaa.bindAddressLabel', { defaultValue: 'Bind Address' }),
      value: gatewayStatus.bindAddress || '—',
      copyable: Boolean(gatewayStatus.enabled && gatewayStatus.bindAddress),
    },
    {
      key: 'issuer',
      label: t('runtimeConfig.eaa.issuerLabel', { defaultValue: 'Issuer' }),
      value: gatewayStatus.issuer || '—',
      copyable: false,
    },
    {
      key: 'active-scopes',
      label: t('runtimeConfig.eaa.activeScopesLabel', { defaultValue: 'Active Scopes' }),
      value: gatewayStatus.actionCount === null ? '—' : String(gatewayStatus.actionCount),
      copyable: false,
    },
    {
      key: 'active-tokens',
      label: t('runtimeConfig.eaa.activeTokensLabel', { defaultValue: 'Active Tokens' }),
      value: gatewayStatus.loading ? '—' : String(tokenCounts.active),
      copyable: false,
    },
  ], [gatewayStatus.bindAddress, gatewayStatus.issuer, gatewayStatus.actionCount, gatewayStatus.loading, tokenCounts.active, t]);

  const subtitleParts: string[] = [];
  subtitleParts.push(t('runtimeConfig.eaa.countActive', { defaultValue: '{{count}} active', count: tokenCounts.active }));
  if (tokenCounts.revoked > 0) {
    subtitleParts.push(t('runtimeConfig.eaa.countRevoked', { defaultValue: '{{count}} revoked', count: tokenCounts.revoked }));
  }
  if (tokenCounts.expired > 0) {
    subtitleParts.push(t('runtimeConfig.eaa.countExpired', { defaultValue: '{{count}} expired', count: tokenCounts.expired }));
  }

  const filterTabs: Array<{ key: TokenFilter; label: string }> = [
    { key: 'all', label: t('runtimeConfig.eaa.filterAll', { defaultValue: 'All' }) },
    { key: 'active', label: t('runtimeConfig.eaa.filterActive', { defaultValue: 'Active' }) },
    { key: 'revoked', label: t('runtimeConfig.eaa.filterRevoked', { defaultValue: 'Revoked' }) },
  ];

  return (
    <>
      {/* Gateway status card */}
      <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-1.5">
              <StatusDot tone={headerDot} pulse={gatewayStatus.enabled} />
            </span>
            <div className="min-w-0">
              <h2 className={cn('text-base font-semibold', TOKEN_TEXT_PRIMARY)}>{gatewayHeadline}</h2>
              <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>{gatewaySubline}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              icon={<RefreshIcon spinning={refreshing} />}
              title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
              disabled={refreshing}
              onClick={() => { void refreshGateway(); }}
            />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {meta.map((entry) => (
            <div
              key={entry.key}
              className="group relative rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-3"
            >
              <p className={cn('text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
                {entry.label}
              </p>
              <p className={cn('mt-1 truncate font-mono text-sm', TOKEN_TEXT_PRIMARY)} title={entry.value}>
                {entry.value}
              </p>
              {entry.copyable ? (
                <button
                  type="button"
                  onClick={onCopyBindAddress}
                  aria-label={copiedBindAddress
                    ? t('runtimeConfig.runtime.copied', { defaultValue: 'Copied' })
                    : t('runtimeConfig.runtime.copy', { defaultValue: 'Copy' })}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-[var(--nimi-text-muted)] opacity-0 transition-opacity hover:bg-[var(--nimi-surface-card)] hover:text-[var(--nimi-text-primary)] group-hover:opacity-100"
                >
                  {copiedBindAddress ? <CheckIcon /> : <CopyIcon />}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </Surface>

      {/* Issued tokens section */}
      <section className="mt-6">
        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
                {t('runtimeConfig.eaa.issuedTokens', { defaultValue: 'Issued tokens' })}
              </h3>
              <p className={cn('mt-1 text-xs', TOKEN_TEXT_MUTED)}>
                {tokenCounts.total === 0
                  ? t('runtimeConfig.eaa.issuedTokensEmptySubtitle', {
                    defaultValue: 'Tokens issued to external principals will appear here.',
                  })
                  : `${t('runtimeConfig.eaa.issuedTokensSubtitle', {
                    defaultValue: 'Tokens issued to external principals.',
                  })} ${subtitleParts.join(' · ')}.`}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {/* Filter segmented control */}
              <div className="inline-flex rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-0.5">
                {filterTabs.map((tab) => {
                  const isActive = tab.key === filter;
                  return (
                    <button
                      key={`token-filter-${tab.key}`}
                      type="button"
                      onClick={() => setFilter(tab.key)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                        isActive
                          ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
                          : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-primary)]',
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <Button
                variant="primary"
                size="sm"
                disabled={!canIssue}
                onClick={() => setShowIssueForm((prev) => !prev)}
              >
                <span className="inline-flex items-center gap-1.5">
                  <PlusIcon />
                  {t('runtimeConfig.eaa.issueToken', { defaultValue: 'Issue token' })}
                </span>
              </Button>
            </div>
          </div>

          {/* Issue Token inline form (collapsible) */}
          {showIssueForm ? (
            <ExternalAgentIssueTokenForm
              actionsInput={actionsInput}
              busy={busy}
              canIssue={canIssue}
              errorMessage={errorMessage}
              issuedToken={issuedToken}
              mode={mode}
              principalId={principalId}
              subjectAccountId={subjectAccountId}
              tokenId={tokenId}
              ttlIsPositiveInteger={ttlIsPositiveInteger}
              ttlSeconds={ttlSeconds}
              ttlValidationMessage={ttlValidationMessage}
              onActionsInputChange={setActionsInput}
              onCancel={() => setShowIssueForm(false)}
              onIssueToken={handleIssueToken}
              onModeChange={setMode}
              onPrincipalIdChange={setPrincipalId}
              onSubjectAccountIdChange={setSubjectAccountId}
              onTtlSecondsChange={setTtlSeconds}
            />
          ) : null}

          <ExternalAgentTokenTable
            busy={busy}
            canIssue={canIssue}
            errorMessage={errorMessage}
            expandedTokenId={expandedTokenId}
            filteredTokens={filteredTokens}
            onExpandedTokenIdChange={setExpandedTokenId}
            onRevokeToken={handleRevokeToken}
            showIssueForm={showIssueForm}
            t={t}
            tokenCount={tokens.length}
          />
        </Surface>
      </section>
    </>
  );
}
