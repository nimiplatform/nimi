import React, { useState, useEffect, useCallback } from 'react';
import { isNimiError } from '@nimiplatform/sdk/runtime/errors.js';
import { OtButton } from './ui-primitives.js';

type ErrorActionType =
  | 'retry'
  | 'setup_connector'
  | 'validation'
  | 'cooldown'
  | 'content_warning'
  | 'timeout_retry'
  | 'generic';

interface ClassifiedError {
  reasonCode: string;
  message: string;
  actionLabel: string;
  actionType: ErrorActionType;
  retryable: boolean;
  cooldownMs?: number;
}

export function classifyError(error: unknown): ClassifiedError {
  const nimiErr = isNimiError(error) ? error : null;
  const reasonCode = nimiErr?.reasonCode ?? '';

  switch (reasonCode) {
    case 'AI_PROVIDER_UNAVAILABLE':
      return {
        reasonCode,
        message: 'Provider temporarily unavailable. Try again or switch to a different model.',
        actionLabel: 'Retry',
        actionType: 'retry',
        retryable: true,
      };
    case 'AI_PROVIDER_AUTH_FAILED':
      return {
        reasonCode,
        message: 'Connector authentication failed. Check your API key in connector settings.',
        actionLabel: 'Check Connector',
        actionType: 'setup_connector',
        retryable: false,
      };
    case 'AI_MEDIA_SPEC_INVALID':
      return {
        reasonCode,
        message: 'Invalid generation parameters. Please adjust your settings.',
        actionLabel: 'Dismiss',
        actionType: 'validation',
        retryable: false,
      };
    case 'AI_MEDIA_OPTION_UNSUPPORTED':
      return {
        reasonCode,
        message: 'This option is not supported by the current model.',
        actionLabel: 'Dismiss',
        actionType: 'validation',
        retryable: false,
      };
    case 'AI_PROVIDER_RATE_LIMITED':
      return {
        reasonCode,
        message: 'Rate limited. Please wait before trying again.',
        actionLabel: 'Wait',
        actionType: 'cooldown',
        retryable: true,
        cooldownMs: 30_000,
      };
    case 'AI_CONTENT_FILTER_BLOCKED':
      return {
        reasonCode,
        message: 'Content was filtered by the provider. Try adjusting your prompt.',
        actionLabel: 'Dismiss',
        actionType: 'content_warning',
        retryable: false,
      };
    case 'AI_PROVIDER_TIMEOUT':
    case 'AI_JOB_TIMEOUT':
      return {
        reasonCode,
        message: 'Generation timed out. You can retry the request.',
        actionLabel: 'Retry',
        actionType: 'timeout_retry',
        retryable: true,
      };
    default: {
      const msg = error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'An unexpected error occurred.';
      return {
        reasonCode: reasonCode || 'UNKNOWN',
        message: msg,
        actionLabel: 'Dismiss',
        actionType: 'generic',
        retryable: false,
      };
    }
  }
}

export function ErrorDisplay({
  error,
  onRetry,
  onDismiss,
}: {
  error: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const classified = classifyError(error);
  const [cooldownLeft, setCooldownLeft] = useState(classified.cooldownMs ?? 0);
  const [shaking, setShaking] = useState(true);

  useEffect(() => {
    if (classified.actionType !== 'cooldown' || !classified.cooldownMs) return;
    setCooldownLeft(classified.cooldownMs);
    const interval = setInterval(() => {
      setCooldownLeft((prev) => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(interval);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [classified.actionType, classified.cooldownMs]);

  useEffect(() => {
    if (!shaking) return;
    const timer = setTimeout(() => setShaking(false), 300);
    return () => clearTimeout(timer);
  }, [shaking]);

  const handleAction = useCallback(() => {
    if (classified.retryable && onRetry) {
      onRetry();
    } else if (onDismiss) {
      onDismiss();
    }
  }, [classified.retryable, onRetry, onDismiss]);

  const isWarning = classified.actionType === 'content_warning' || classified.actionType === 'cooldown';
  const borderColor = isWarning ? 'border-[color-mix(in_srgb,var(--nimi-status-warning)_20%,transparent)]' : 'border-[color-mix(in_srgb,var(--nimi-status-danger)_20%,transparent)]';
  const bgColor = isWarning ? 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,transparent)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)]';
  const textColor = isWarning ? 'text-[var(--nimi-status-warning)]' : 'text-[var(--nimi-status-danger)]';

  return (
    <div className={`p-3 rounded-lg border ${borderColor} ${bgColor} space-y-2 ${shaking ? 'ot-input--shake' : ''}`}>
      <div className="flex items-start gap-2">
        <span className={`${textColor} text-sm shrink-0 mt-0.5`}>
          {isWarning ? '\u26A0' : '\u2718'}
        </span>
        <p className={`text-xs ${textColor} flex-1`}>{classified.message}</p>
      </div>

      <div className="flex items-center gap-2">
        {classified.actionType === 'cooldown' && cooldownLeft > 0 ? (
          <span className="text-[10px] text-[var(--nimi-status-warning)] tabular-nums font-mono">
            Retry in {Math.ceil(cooldownLeft / 1000)}s
          </span>
        ) : (
          <>
            {classified.retryable && onRetry && (
              <OtButton variant="tertiary" className="text-[10px] py-0.5 px-2" onClick={handleAction} type="button">
                {classified.actionLabel}
              </OtButton>
            )}
            {onDismiss && (
              <OtButton variant="tertiary" className="text-[10px] py-0.5 px-2" onClick={onDismiss} type="button">
                Dismiss
              </OtButton>
            )}
          </>
        )}
      </div>
    </div>
  );
}
