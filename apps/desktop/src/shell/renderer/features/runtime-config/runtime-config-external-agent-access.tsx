import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, Surface, Tooltip, cn } from '@nimiplatform/nimi-kit/ui';
import { SectionTitle } from '@renderer/features/settings/settings-layout-components';
import {
  getExternalAgentGatewayStatus,
  issueExternalAgentToken,
  listExternalAgentTokens,
  revokeExternalAgentToken,
  type ExternalAgentTokenRecord,
} from '@runtime/external-agent';
import { Button, Input, RuntimeSelect } from './runtime-config-primitives';

type TokenMode = 'delegated' | 'autonomous';

const TOKEN_TEXT_PRIMARY = 'text-[var(--nimi-text-primary)]';
const TOKEN_TEXT_SECONDARY = 'text-[var(--nimi-text-secondary)]';
const TOKEN_TEXT_MUTED = 'text-[var(--nimi-text-muted)]';
const TOKEN_PANEL_CARD = 'rounded-2xl';

type StateTone = 'success' | 'warning' | 'danger' | 'neutral';

const STATE_BADGE_CLASS: Record<StateTone, { pill: string; dot: string; text: string }> = {
  success: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]',
    dot: 'bg-[var(--nimi-status-success)]',
    text: 'text-[var(--nimi-status-success)]',
  },
  warning: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]',
    dot: 'bg-[var(--nimi-status-warning)]',
    text: 'text-[var(--nimi-status-warning)]',
  },
  danger: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_14%,transparent)] text-[var(--nimi-status-danger)]',
    dot: 'bg-[var(--nimi-status-danger)]',
    text: 'text-[var(--nimi-status-danger)]',
  },
  neutral: {
    pill: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_14%,transparent)] text-[var(--nimi-text-secondary)]',
    dot: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_65%,transparent)]',
    text: 'text-[var(--nimi-text-secondary)]',
  },
};

function StateBadge({ tone, label }: { tone: StateTone; label: string }) {
  const style = STATE_BADGE_CLASS[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', style.pill)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {label}
    </span>
  );
}

function IconButton({
  icon,
  title,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={title} placement="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-panel)] hover:text-[var(--nimi-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? 'animate-spin' : ''}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

type GatewayStatusParsed = {
  enabled: boolean;
  loading: boolean;
  bindAddress: string;
  issuer: string;
  actionCount: number | null;
  errored: boolean;
};

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

  const gatewayTone: StateTone = gatewayStatus.loading
    ? 'neutral'
    : gatewayStatus.enabled
      ? 'success'
      : gatewayStatus.errored
        ? 'danger'
        : 'neutral';
  const gatewayLabel = gatewayStatus.loading
    ? t('runtimeConfig.eaa.loadingStatus', { defaultValue: 'Loading...' })
    : gatewayStatus.errored
      ? t('runtimeConfig.eaa.gatewayUnavailable', { defaultValue: 'Gateway unavailable' })
      : gatewayStatus.enabled
        ? t('runtimeConfig.eaa.enabled', { defaultValue: 'Enabled' })
        : t('runtimeConfig.eaa.disabled', { defaultValue: 'Disabled' });

  const canIssue = gatewayStatus.enabled && !gatewayStatus.loading;

  const meta = useMemo(() => [
    {
      key: 'bind',
      label: t('runtimeConfig.eaa.bindAddressLabel', { defaultValue: 'Bind Address' }),
      value: gatewayStatus.bindAddress || '\u2014',
    },
    {
      key: 'issuer',
      label: t('runtimeConfig.eaa.issuerLabel', { defaultValue: 'Issuer' }),
      value: gatewayStatus.issuer || '\u2014',
    },
    {
      key: 'actions',
      label: t('runtimeConfig.eaa.actionCountLabel', { defaultValue: 'Actions' }),
      value: gatewayStatus.actionCount === null ? '\u2014' : String(gatewayStatus.actionCount),
    },
  ], [gatewayStatus.bindAddress, gatewayStatus.issuer, gatewayStatus.actionCount, t]);

  return (
    <>
      <section>
        <SectionTitle>
          {t('runtimeConfig.eaa.sectionTitle', { defaultValue: 'External Agent Access' })}
        </SectionTitle>

        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'mt-3 p-5')}>
          {/* Header: title + gateway state badge + refresh */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h3 className={cn('text-sm font-semibold', TOKEN_TEXT_PRIMARY)}>
                {t('runtimeConfig.eaa.gatewayStatusTitle', { defaultValue: 'Gateway Status & Issue Token' })}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <StateBadge tone={gatewayTone} label={gatewayLabel} />
              <IconButton
                icon={<RefreshIcon spinning={refreshing} />}
                title={t('runtimeConfig.runtime.refresh', { defaultValue: 'Refresh' })}
                disabled={refreshing}
                onClick={() => { void refreshGateway(); }}
              />
            </div>
          </div>

          {/* Gateway meta — vital-style micro cards */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {meta.map((entry) => (
              <div
                key={entry.key}
                className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-3"
              >
                <p className={cn('text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
                  {entry.label}
                </p>
                <p className={cn('mt-1 truncate font-mono text-sm', TOKEN_TEXT_PRIMARY)} title={entry.value}>
                  {entry.value}
                </p>
              </div>
            ))}
          </div>

          {/* Issue Token form */}
          <div className="mt-6">
            <p className={cn('mb-3 text-[10px] font-medium uppercase tracking-[0.14em]', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.eaa.issueTokenGroup', { defaultValue: 'Issue Token' })}
            </p>
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

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !canIssue || !ttlIsPositiveInteger}
                onClick={handleIssueToken}
              >
                {busy
                  ? t('runtimeConfig.eaa.issuing', { defaultValue: 'Issuing...' })
                  : t('runtimeConfig.eaa.issueToken', { defaultValue: 'Issue Token' })}
              </Button>
              {tokenId ? (
                <span className={cn('font-mono text-[11px]', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.eaa.tokenIdLabel', { defaultValue: 'tokenId' })}: {tokenId}
                </span>
              ) : null}
            </div>

            {issuedToken ? (
              <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cn('text-[10px] font-medium uppercase tracking-[0.14em]', 'text-[var(--nimi-status-warning)]')}>
                      {t('runtimeConfig.eaa.issuedTokenLabel', { defaultValue: 'Newly issued token — copy now' })}
                    </p>
                    <pre className={cn('mt-2 whitespace-pre-wrap break-all rounded-md bg-[var(--nimi-surface-card)] px-3 py-2 font-mono text-[11px] leading-relaxed', TOKEN_TEXT_PRIMARY)}>
                      {issuedToken}
                    </pre>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || !canIssue || !tokenId.trim()}
                      onClick={() => handleRevokeToken()}
                    >
                      {t('runtimeConfig.eaa.revokeThisToken', { defaultValue: 'Revoke This Token' })}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {errorMessage ? (
              <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{errorMessage}</p>
            ) : null}
          </div>
        </Surface>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-3">
          <SectionTitle
            description={t('runtimeConfig.eaa.issuedTokensDesc', {
              defaultValue: 'Tokens issued to external principals. Revoke any token to immediately invalidate it.',
            })}
          >
            {t('runtimeConfig.eaa.issuedTokens', { defaultValue: 'Issued Tokens' })}
          </SectionTitle>
          <span className={cn('shrink-0 pb-0.5 text-xs', TOKEN_TEXT_MUTED)}>
            <span className={cn('font-medium', TOKEN_TEXT_PRIMARY)}>{tokens.length}</span>{' '}
            {t('runtimeConfig.eaa.tokensSuffix', { defaultValue: 'total' })}
          </span>
        </div>

        <Surface tone="card" className={cn(TOKEN_PANEL_CARD, 'p-5')}>
          {tokens.length <= 0 ? (
            <p className={cn('text-sm', TOKEN_TEXT_MUTED)}>
              {t('runtimeConfig.eaa.noTokensIssued', { defaultValue: 'No tokens issued.' })}
            </p>
          ) : (
            <ScrollArea className="max-h-72" viewportClassName="max-h-72">
              <div className="divide-y divide-[var(--nimi-border-subtle)]/60">
                {tokens.map((token) => {
                  const isRevoked = Boolean(token.revokedAt);
                  const isExpired = token.expiresAt && new Date(token.expiresAt).getTime() < Date.now();
                  const tokenStatus: 'active' | 'expired' | 'revoked' = isRevoked
                    ? 'revoked'
                    : isExpired
                      ? 'expired'
                      : 'active';
                  const tone: StateTone = tokenStatus === 'active'
                    ? 'success'
                    : tokenStatus === 'expired'
                      ? 'warning'
                      : 'neutral';
                  const statusLabel = tokenStatus === 'active'
                    ? t('runtimeConfig.eaa.tokenStatusActive', { defaultValue: 'active' })
                    : tokenStatus === 'expired'
                      ? t('runtimeConfig.eaa.tokenStatusExpired', { defaultValue: 'expired' })
                      : t('runtimeConfig.eaa.tokenStatusRevoked', { defaultValue: 'revoked' });

                  return (
                    <div key={token.tokenId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={cn('truncate text-sm font-medium', TOKEN_TEXT_PRIMARY)}>
                            {token.principalId}
                          </span>
                          <StateBadge tone={tone} label={statusLabel} />
                        </div>
                        {!isRevoked ? (
                          <button
                            type="button"
                            className="shrink-0 text-[11px] font-medium text-[var(--nimi-status-danger)] transition-colors hover:underline disabled:cursor-not-allowed disabled:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)]"
                            disabled={busy || !canIssue}
                            onClick={() => handleRevokeToken(token.tokenId)}
                          >
                            {t('runtimeConfig.eaa.revoke', { defaultValue: 'Revoke' })}
                          </button>
                        ) : null}
                      </div>
                      <div className={cn('mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11px]', TOKEN_TEXT_MUTED)}>
                        <span>
                          {t('runtimeConfig.eaa.tokenModeLabel', { defaultValue: 'mode' })}={token.mode}
                        </span>
                        <span>
                          {t('runtimeConfig.eaa.tokenSubjectLabel', { defaultValue: 'subject' })}={token.subjectAccountId || '-'}
                        </span>
                        <span>
                          {t('runtimeConfig.eaa.tokenExpiresLabel', { defaultValue: 'expires' })}={token.expiresAt || '-'}
                        </span>
                        {token.revokedAt ? (
                          <span>
                            {t('runtimeConfig.eaa.tokenRevokedLabel', { defaultValue: 'revoked' })}={token.revokedAt}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </Surface>
      </section>
    </>
  );
}
