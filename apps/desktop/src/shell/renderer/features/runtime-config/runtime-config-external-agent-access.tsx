import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Surface, cn } from '@nimiplatform/nimi-kit/ui';
import {
  getExternalAgentGatewayStatus,
  issueExternalAgentToken,
  listExternalAgentTokens,
  revokeExternalAgentToken,
  type ExternalAgentTokenRecord,
} from '@runtime/external-agent';
import { Button, Input, RuntimeSelect } from './runtime-config-primitives';
import {
  CheckIcon,
  ChevronIcon,
  ClockIcon,
  CopyIcon,
  IconButton,
  PlusIcon,
  RefreshIcon,
  ServiceIcon,
  StatusDot,
  UserIcon,
  STATUS_TONE,
  TOKEN_PANEL_CARD,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
  relativeFromNow,
  resolveTokenStatus,
  type GatewayStatusParsed,
  type TokenFilter,
  type TokenMode,
} from './runtime-config-external-agent-access-model';

export function ExternalAgentAccessPanel() {
  const { t } = useTranslation();
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusParsed>({
    enabled: false,
    loading: true,
    bindAddress: '',
    issuer: '',
    actionCount: null,
    errored: false,
  });
  const [principalId, setPrincipalId] = useState('openclaw.local');
  const [subjectAccountId, setSubjectAccountId] = useState('');
  const [mode, setMode] = useState<TokenMode>('delegated');
  const [actionsInput, setActionsInput] = useState('runtime.local-ai.models.list');
  const [ttlSeconds, setTtlSeconds] = useState('3600');
  const [tokenId, setTokenId] = useState('');
  const [issuedToken, setIssuedToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [tokens, setTokens] = useState<ExternalAgentTokenRecord[]>([]);
  const [copiedToken, setCopiedToken] = useState(false);
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
      const status = await getExternalAgentGatewayStatus();
      const rows = await listExternalAgentTokens();
      setGatewayStatus({
        enabled: Boolean(status.enabled),
        loading: false,
        bindAddress: status.bindAddress || '',
        issuer: status.issuer || '',
        actionCount: typeof status.actionCount === 'number' ? status.actionCount : null,
        errored: false,
      });
      setTokens(rows);
    } catch (error) {
      setGatewayStatus({
        enabled: false,
        loading: false,
        bindAddress: '',
        issuer: '',
        actionCount: null,
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
        const issued = await issueExternalAgentToken({
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
        await revokeExternalAgentToken(resolvedTokenId);
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

  const onCopyIssuedToken = () => {
    if (!issuedToken) return;
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (!clip?.writeText) return;
    void clip.writeText(issuedToken).then(() => {
      setCopiedToken(true);
      window.setTimeout(() => setCopiedToken(false), 1500);
    }).catch(() => undefined);
  };

  const onCopyBindAddress = () => {
    if (!gatewayStatus.bindAddress) return;
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (!clip?.writeText) return;
    void clip.writeText(gatewayStatus.bindAddress).then(() => {
      setCopiedBindAddress(true);
      window.setTimeout(() => setCopiedBindAddress(false), 1500);
    }).catch(() => undefined);
  };

  const canIssue = gatewayStatus.enabled && !gatewayStatus.loading;

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
      : gatewayStatus.enabled
        ? t('runtimeConfig.eaa.gatewayAcceptingHeadline', { defaultValue: 'Gateway is accepting connections' })
        : t('runtimeConfig.eaa.gatewayOfflineHeadline', { defaultValue: 'Gateway is offline' });

  const gatewaySubline = gatewayStatus.errored
    ? t('runtimeConfig.eaa.gatewayErrorSubline', { defaultValue: 'Unable to reach the local runtime gateway.' })
    : gatewayStatus.enabled
      ? t('runtimeConfig.eaa.gatewayAcceptingSubline', { defaultValue: 'External agents can request tokens at the bind address below.' })
      : t('runtimeConfig.eaa.gatewayOfflineSubline', { defaultValue: 'Start the runtime daemon to accept external agent connections.' });

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
      copyable: Boolean(gatewayStatus.bindAddress),
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
            <div className="mt-5 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input
                  label={t('runtimeConfig.eaa.principalId', { defaultValue: 'Principal ID' })}
                  value={principalId}
                  onChange={setPrincipalId}
                  placeholder="openclaw.local"
                />
                <Input
                  label={t('runtimeConfig.eaa.subjectAccountId', { defaultValue: 'Subject Account ID' })}
                  value={subjectAccountId}
                  onChange={setSubjectAccountId}
                  placeholder={t('runtimeConfig.eaa.subjectAccountPlaceholder', { defaultValue: 'user_123 / external_456' })}
                />
                <div>
                  <label className={cn('mb-1.5 block text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
                    {t('runtimeConfig.runtime.mode', { defaultValue: 'Mode' })}
                  </label>
                  <RuntimeSelect
                    value={mode}
                    onChange={(nextMode) => setMode(nextMode === 'autonomous' ? 'autonomous' : 'delegated')}
                    className="w-full"
                    options={[
                      { value: 'delegated', label: t('runtimeConfig.eaa.modeDelegated', { defaultValue: 'delegated' }) },
                      { value: 'autonomous', label: t('runtimeConfig.eaa.modeAutonomous', { defaultValue: 'autonomous' }) },
                    ]}
                  />
                </div>
                <Input
                  label={t('runtimeConfig.eaa.ttlSeconds', { defaultValue: 'TTL Seconds' })}
                  value={ttlSeconds}
                  onChange={setTtlSeconds}
                  placeholder="3600"
                />
              </div>

              <div className="mt-3">
                <Input
                  label={t('runtimeConfig.eaa.actionScopes', { defaultValue: 'Action Scopes (comma separated)' })}
                  value={actionsInput}
                  onChange={setActionsInput}
                  placeholder="runtime.local-ai.models.list"
                />
              </div>

              {ttlValidationMessage ? (
                <p className="mt-2 text-xs text-[var(--nimi-status-warning)]">{ttlValidationMessage}</p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowIssueForm(false)}>
                  {t('runtimeConfig.eaa.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || !canIssue || !ttlIsPositiveInteger}
                  onClick={handleIssueToken}
                >
                  {busy
                    ? t('runtimeConfig.eaa.issuing', { defaultValue: 'Issuing...' })
                    : t('runtimeConfig.eaa.issueToken', { defaultValue: 'Issue token' })}
                </Button>
              </div>

              {issuedToken ? (
                <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={cn('text-[10px] font-medium uppercase tracking-[0.14em]', 'text-[var(--nimi-status-warning)]')}>
                        {t('runtimeConfig.eaa.issuedTokenLabel', { defaultValue: 'Newly issued token — copy now' })}
                      </p>
                      <pre className={cn('mt-2 whitespace-pre-wrap break-all rounded-md bg-[var(--nimi-surface-card)] px-3 py-2 font-mono text-[11px] leading-relaxed', TOKEN_TEXT_PRIMARY)}>
                        {issuedToken}
                      </pre>
                      {tokenId ? (
                        <p className={cn('mt-2 font-mono text-[11px]', TOKEN_TEXT_MUTED)}>
                          {t('runtimeConfig.eaa.tokenIdLabel', { defaultValue: 'tokenId' })}: {tokenId}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={onCopyIssuedToken}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1 text-[11px] font-medium transition-colors hover:border-[var(--nimi-border-strong)]',
                          copiedToken ? 'text-[var(--nimi-status-success)]' : TOKEN_TEXT_SECONDARY,
                        )}
                        aria-label={copiedToken
                          ? t('runtimeConfig.runtime.copied', { defaultValue: 'Copied' })
                          : t('runtimeConfig.runtime.copy', { defaultValue: 'Copy' })}
                      >
                        {copiedToken ? <CheckIcon /> : <CopyIcon />}
                        <span>
                          {copiedToken
                            ? t('runtimeConfig.runtime.copied', { defaultValue: 'Copied' })
                            : t('runtimeConfig.runtime.copy', { defaultValue: 'Copy' })}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {errorMessage ? (
                <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{errorMessage}</p>
              ) : null}
            </div>
          ) : null}

          {/* Tokens table */}
          <div className="mt-5">
            {filteredTokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--nimi-border-subtle)] py-10 text-center">
                <p className={cn('text-sm', TOKEN_TEXT_SECONDARY)}>
                  {tokens.length === 0
                    ? t('runtimeConfig.eaa.noTokensIssued', { defaultValue: 'No tokens issued.' })
                    : t('runtimeConfig.eaa.noTokensInFilter', { defaultValue: 'No tokens match this filter.' })}
                </p>
                {tokens.length === 0 ? (
                  <p className={cn('text-xs', TOKEN_TEXT_MUTED)}>
                    {t('runtimeConfig.eaa.noTokensIssuedHint', { defaultValue: 'Issue a token to let an external agent call the runtime.' })}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                {/* Column headers */}
                <div className={cn('grid grid-cols-[1.4fr_0.8fr_2fr_0.9fr_0.9fr_0.6fr] items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
                  <span>{t('runtimeConfig.eaa.columnPrincipal', { defaultValue: 'Principal' })}</span>
                  <span>{t('runtimeConfig.eaa.columnMode', { defaultValue: 'Mode' })}</span>
                  <span>{t('runtimeConfig.eaa.columnScopes', { defaultValue: 'Scopes' })}</span>
                  <span>{t('runtimeConfig.eaa.columnExpires', { defaultValue: 'Expires' })}</span>
                  <span>{t('runtimeConfig.eaa.columnIssued', { defaultValue: 'Issued' })}</span>
                  <span className="text-right">{t('runtimeConfig.eaa.columnActions', { defaultValue: '' })}</span>
                </div>

                <div className="divide-y divide-[var(--nimi-border-subtle)]/60">
                  {filteredTokens.map((token) => {
                    const status = resolveTokenStatus(token);
                    const tone = STATUS_TONE[status];
                    const isExpanded = expandedTokenId === token.tokenId;
                    const expiresRel = relativeFromNow(token.expiresAt, t);
                    const issuedRel = relativeFromNow(token.issuedAt, t);
                    const isService = !!token.subjectAccountId && token.subjectAccountId.startsWith('service_');
                    const displayScopes = token.actions.length > 0
                      ? token.actions
                      : token.scopes.map((scope) => scope.actionId);
                    const visibleScopes = displayScopes.slice(0, 3);
                    const overflowCount = displayScopes.length - visibleScopes.length;

                    return (
                      <div key={token.tokenId} className="group">
                        <button
                          type="button"
                          onClick={() => setExpandedTokenId(isExpanded ? '' : token.tokenId)}
                          className="grid w-full grid-cols-[1.4fr_0.8fr_2fr_0.9fr_0.9fr_0.6fr] items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-[var(--nimi-surface-panel)]/50"
                        >
                          {/* Principal */}
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

                          {/* Mode */}
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

                          {/* Scopes */}
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

                          {/* Expires */}
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

                          {/* Issued */}
                          <div className={cn('text-[11px]', TOKEN_TEXT_MUTED)}>
                            {issuedRel}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center justify-end gap-1.5">
                            {status !== 'revoked' ? (
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleRevokeToken(token.tokenId);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleRevokeToken(token.tokenId);
                                  }
                                }}
                                className={cn(
                                  'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                                  busy || !canIssue
                                    ? 'cursor-not-allowed text-[color-mix(in_srgb,var(--nimi-text-muted)_70%,transparent)]'
                                    : 'text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] hover:text-[var(--nimi-status-danger)]',
                                )}
                              >
                                {t('runtimeConfig.eaa.revoke', { defaultValue: 'Revoke' })}
                              </span>
                            ) : null}
                            <span className={cn('text-[var(--nimi-text-muted)] transition-colors group-hover:text-[var(--nimi-text-primary)]')}>
                              <ChevronIcon expanded={isExpanded} />
                            </span>
                          </div>
                        </button>

                        {isExpanded ? (
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
                                  {displayScopes.length === 0 ? (
                                    <span className={cn('font-mono', TOKEN_TEXT_MUTED)}>—</span>
                                  ) : (
                                    displayScopes.map((scope) => (
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
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {errorMessage && !showIssueForm ? (
              <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{errorMessage}</p>
            ) : null}
          </div>
        </Surface>
      </section>
    </>
  );
}
