import { useCallback } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
import { DesktopCompactAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
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
    ? t('Chat.memoryModeChecking', { defaultValue: 'Checking...' })
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
    <div className="flex shrink-0 flex-col gap-4">
      <DesktopCardSurface
        kind="operational-solid"
        as="section"
        data-testid={E2E_IDS.chatMemoryModeCard}
        className="flex flex-col px-5 py-5 text-left"
      >
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-slate-950">
              {t('Chat.memoryModeTitle', { defaultValue: 'Memory mode' })}
            </p>
            <span
              data-testid={E2E_IDS.chatMemoryModeStatus}
              data-memory-mode={memoryModeValue}
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.05em]',
                props.memoryStatus?.mode === 'standard'
                  ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,white)] text-[var(--nimi-action-primary-bg)]'
                  : props.memoryStatus?.mode === 'unavailable'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-500',
              )}
            >
              {memoryModeLabel}
            </span>
          </div>
          <p className="mt-4 text-[13px] leading-7 text-slate-500">
            {memoryModeHint}
          </p>
        </div>
        {props.memoryStatus?.mode === 'baseline' ? (
          <div className="mt-5 flex flex-col gap-2">
            <DesktopCompactAction
              data-testid={E2E_IDS.chatMemoryModeUpgradeButton}
              disabled={props.disabled || props.memoryLoading || !props.onUpgradeStandardMemory}
              onClick={handleUpgradeStandardMemory}
              tone="primary"
              fullWidth
            >
              {t('Chat.memoryModeUpgradeAction', { defaultValue: 'Upgrade to Standard memory' })}
            </DesktopCompactAction>
          </div>
        ) : null}
      </DesktopCardSurface>
      <DesktopCardSurface kind="operational-solid" as="section" className="flex flex-col px-5 py-5 text-left">
        <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-slate-950">
          {t('Chat.clearAgentChatHistoryTitle', { defaultValue: 'Clear agent chat history' })}
        </p>
        <p className="mt-4 flex-1 text-[13px] leading-7 text-slate-500">
          {t('Chat.clearAgentChatHistoryHint', {
            defaultValue: 'Delete every local chat record with this agent on this device.',
          })}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <DesktopCompactAction
            disabled={props.disabled || !props.activeThreadId}
            onClick={handleClearAgentHistory}
            tone="danger"
            fullWidth
          >
            {t('Chat.clearAgentChatHistoryAction', { defaultValue: 'Clear agent chat history' })}
          </DesktopCompactAction>
        </div>
      </DesktopCardSurface>
    </div>
  );
}
