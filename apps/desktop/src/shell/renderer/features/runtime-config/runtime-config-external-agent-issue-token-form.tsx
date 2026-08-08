import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@nimiplatform/kit/ui';
import { Button, Input, RuntimeSelect } from './runtime-config-primitives';
import {
  CheckIcon,
  CopyIcon,
  TOKEN_TEXT_MUTED,
  TOKEN_TEXT_PRIMARY,
  TOKEN_TEXT_SECONDARY,
  type TokenMode,
} from './runtime-config-external-agent-access-model';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

type ExternalAgentIssueTokenFormProps = {
  actionsInput: string;
  busy: boolean;
  canIssue: boolean;
  errorMessage: string;
  issuedToken: string;
  mode: TokenMode;
  principalId: string;
  subjectAccountId: string;
  tokenId: string;
  ttlIsPositiveInteger: boolean;
  ttlSeconds: string;
  ttlValidationMessage: string;
  onActionsInputChange: (value: string) => void;
  onCancel: () => void;
  onIssueToken: () => void;
  onModeChange: (value: TokenMode) => void;
  onPrincipalIdChange: (value: string) => void;
  onSubjectAccountIdChange: (value: string) => void;
  onTtlSecondsChange: (value: string) => void;
};

export function ExternalAgentIssueTokenForm(props: ExternalAgentIssueTokenFormProps) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [copiedToken, setCopiedToken] = useState(false);
  const clearCopiedCancelRef = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    clearCopiedCancelRef.current?.();
    clearCopiedCancelRef.current = null;
  }, []);

  const onCopyIssuedToken = () => {
    if (!props.issuedToken) return;
    void bindings.app.commands.writeClipboardText(props.issuedToken).then(() => {
      setCopiedToken(true);
      clearCopiedCancelRef.current?.();
      clearCopiedCancelRef.current = bindings.clock.schedule(1_500, () => {
        clearCopiedCancelRef.current = null;
        setCopiedToken(false);
      });
    }).catch(() => undefined);
  };

  return (
    <div className="mt-5 rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/40 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input
          label={t('runtimeConfig.eaa.principalId', { defaultValue: 'Principal ID' })}
          value={props.principalId}
          onChange={props.onPrincipalIdChange}
          placeholder="openclaw.local"
        />
        <Input
          label={t('runtimeConfig.eaa.subjectAccountId', { defaultValue: 'Subject Account ID' })}
          value={props.subjectAccountId}
          onChange={props.onSubjectAccountIdChange}
          placeholder={t('runtimeConfig.eaa.subjectAccountPlaceholder', { defaultValue: 'user_123 / external_456' })}
        />
        <div>
          <label className={cn('mb-1.5 block text-sm font-medium', TOKEN_TEXT_SECONDARY)}>
            {t('runtimeConfig.runtime.mode', { defaultValue: 'Mode' })}
          </label>
          <RuntimeSelect
            value={props.mode}
            onChange={(nextMode) => props.onModeChange(nextMode === 'autonomous' ? 'autonomous' : 'delegated')}
            className="w-full"
            options={[
              { value: 'delegated', label: t('runtimeConfig.eaa.modeDelegated', { defaultValue: 'delegated' }) },
              { value: 'autonomous', label: t('runtimeConfig.eaa.modeAutonomous', { defaultValue: 'autonomous' }) },
            ]}
          />
        </div>
        <Input
          label={t('runtimeConfig.eaa.ttlSeconds', { defaultValue: 'TTL Seconds' })}
          value={props.ttlSeconds}
          onChange={props.onTtlSecondsChange}
          placeholder="3600"
        />
      </div>

      <div className="mt-3">
        <Input
          label={t('runtimeConfig.eaa.actionScopes', { defaultValue: 'Action Scopes (comma separated)' })}
          value={props.actionsInput}
          onChange={props.onActionsInputChange}
          placeholder={t('runtimeConfig.eaa.actionScopesPlaceholder', { defaultValue: 'Runtime action id' })}
        />
      </div>

      {props.ttlValidationMessage ? (
        <p className="mt-2 text-xs text-[var(--nimi-status-warning)]">{props.ttlValidationMessage}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={props.onCancel}>
          {t('runtimeConfig.eaa.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={props.busy || !props.canIssue || !props.ttlIsPositiveInteger}
          onClick={props.onIssueToken}
        >
          {props.busy
            ? t('runtimeConfig.eaa.issuing', { defaultValue: 'Issuing...' })
            : t('runtimeConfig.eaa.issueToken', { defaultValue: 'Issue token' })}
        </Button>
      </div>

      {props.issuedToken ? (
        <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn('text-[length:var(--nimi-type-caption-size)] font-medium uppercase tracking-[var(--nimi-type-overline-letter-spacing)]', 'text-[var(--nimi-status-warning)]')}>
                {t('runtimeConfig.eaa.issuedTokenLabel', { defaultValue: 'Newly issued token — copy now' })}
              </p>
              <pre className={cn('mt-2 whitespace-pre-wrap break-all rounded-md bg-[var(--nimi-surface-card)] px-3 py-2 font-mono text-[length:var(--nimi-type-caption-size)] leading-relaxed', TOKEN_TEXT_PRIMARY)}>
                {props.issuedToken}
              </pre>
              {props.tokenId ? (
                <p className={cn('mt-2 font-mono text-[length:var(--nimi-type-caption-size)]', TOKEN_TEXT_MUTED)}>
                  {t('runtimeConfig.eaa.tokenIdLabel', { defaultValue: 'tokenId' })}: {props.tokenId}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <button
                type="button"
                onClick={onCopyIssuedToken}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-2 py-1 text-[length:var(--nimi-type-caption-size)] font-medium transition-colors hover:border-[var(--nimi-border-strong)]',
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

      {props.errorMessage ? (
        <p className="mt-3 text-xs text-[var(--nimi-status-danger)]">{props.errorMessage}</p>
      ) : null}
    </div>
  );
}
