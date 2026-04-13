import { useCallback } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { confirmDialog } from '@renderer/bridge/runtime-bridge/ui';
import type { CanonicalMemoryBankStatus } from '@renderer/infra/runtime-agent-memory';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type ChatAgentHistoryPanelProps = {
  targetTitle: string;
  activeThreadId: string | null;
  disabled?: boolean;
  memoryStatus?: CanonicalMemoryBankStatus | null;
  memoryLoading?: boolean;
  onUpgradeStandardMemory?: () => unknown;
  onClearAgentHistory: (threadId: string) => unknown;
};

export function ChatAgentHistoryPanel(props: ChatAgentHistoryPanelProps) {
  const { t } = useTranslation();

  const handleClearAgentHistory = useCallback(() => {
    void (async () => {
      if (!props.activeThreadId) {
        return;
      }
      const confirmation = await confirmDialog({
        title: t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' }),
        description: t('Chat.clearAgentChatHistoryConfirm', {
          defaultValue: 'Clear all local chat history with {{name}}? This cannot be undone.',
          name: props.targetTitle,
        }),
        level: 'warning',
      });
      if (!confirmation.confirmed) {
        return;
      }
      await props.onClearAgentHistory(props.activeThreadId);
    })().catch(() => {
      // Host action error handling lives upstream; swallow confirm failures here to avoid unhandled rejections.
    });
  }, [props, t]);

  const handleUpgradeStandardMemory = useCallback(() => {
    void (async () => {
      if (!props.onUpgradeStandardMemory || props.memoryStatus?.mode !== 'baseline') {
        return;
      }
      const confirmation = await confirmDialog({
        title: t('Chat.upgradeStandardMemoryTitle', { defaultValue: 'Upgrade to Standard memory' }),
        description: t('Chat.upgradeStandardMemoryConfirm', {
          defaultValue: 'Bind {{name}} canonical memory to this device embedding profile? This is an explicit upgrade from Baseline to Standard memory.',
          name: props.targetTitle,
        }),
        level: 'warning',
      });
      if (!confirmation.confirmed) {
        return;
      }
      await props.onUpgradeStandardMemory();
    })().catch(() => {
      // Host action error handling lives upstream; swallow confirm failures here to avoid unhandled rejections.
    });
  }, [props, t]);

  const memoryModeValue = props.memoryLoading
    ? 'checking'
    : props.memoryStatus?.mode === 'standard'
      ? 'standard'
      : props.memoryStatus?.mode === 'unavailable'
        ? 'unavailable'
        : 'baseline';
  const memoryModeLabel = props.memoryLoading
    ? t('Chat.memoryModeChecking', { defaultValue: 'Checking…' })
    : props.memoryStatus?.mode === 'standard'
      ? t('Chat.memoryModeStandard', { defaultValue: 'Standard' })
      : props.memoryStatus?.mode === 'unavailable'
        ? t('Chat.memoryModeUnavailable', { defaultValue: 'Unavailable' })
        : t('Chat.memoryModeBaseline', { defaultValue: 'Baseline' });
  const memoryModeHint = props.memoryStatus?.mode === 'standard'
    ? t('Chat.memoryModeStandardHint', {
      defaultValue: 'Canonical memory is bound to the local embedding profile for richer recall.',
    })
    : props.memoryStatus?.mode === 'unavailable'
      ? t('Chat.memoryModeUnavailableHint', {
        defaultValue: 'Standard memory is unavailable until the runtime has an active local embedding asset.',
      })
      : t('Chat.memoryModeBaselineHint', {
        defaultValue: 'Canonical memory stays in Baseline until you explicitly bind a local embedding profile.',
      });

  return (
    <div className="grid shrink-0 gap-4 md:grid-cols-2">
      <section
        data-testid={E2E_IDS.chatMemoryModeCard}
        className="rounded-3xl border border-emerald-200/70 bg-white/78 px-4 py-4 text-left shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-600">
              {t('Chat.memoryModeTitle', { defaultValue: 'Memory mode' })}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {memoryModeHint}
            </p>
          </div>
          <span
            data-testid={E2E_IDS.chatMemoryModeStatus}
            data-memory-mode={memoryModeValue}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em]',
              props.memoryStatus?.mode === 'standard'
                ? 'bg-emerald-100 text-emerald-700'
                : props.memoryStatus?.mode === 'unavailable'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-600',
            )}
          >
            {memoryModeLabel}
          </span>
        </div>
        {props.memoryStatus?.mode === 'baseline' ? (
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              data-testid={E2E_IDS.chatMemoryModeUpgradeButton}
              disabled={props.disabled || props.memoryLoading || !props.onUpgradeStandardMemory}
              onClick={handleUpgradeStandardMemory}
              className={cn(
                'inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                'border-emerald-300 bg-emerald-500 text-white hover:bg-emerald-600',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {t('Chat.memoryModeUpgradeAction', { defaultValue: 'Upgrade to Standard memory' })}
            </button>
          </div>
        ) : null}
      </section>
      <section className="rounded-3xl border border-red-200/70 bg-white/78 px-4 py-4 text-left shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-red-500">
          {t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' })}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {t('Chat.clearAgentChatHistoryHint', {
            defaultValue: 'Delete every local chat record with this agent on this device.',
          })}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={props.disabled || !props.activeThreadId}
            onClick={handleClearAgentHistory}
            className={cn(
              'inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
              'border-red-300 bg-red-500 text-white hover:bg-red-600',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {t('Chat.clearAgentChatHistoryAction', { defaultValue: 'Clear agent chat history' })}
          </button>
        </div>
      </section>
    </div>
  );
}
