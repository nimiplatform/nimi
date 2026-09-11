// Shared ⋯ menu + remove confirmation for one Apps entry, used by the home
// rows and the merged rail rows so both expose the exact same action set.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Info, Play, Square, Trash2, X } from 'lucide-react';
import { ConfirmDialog, type NimiMenuItem } from '@nimiplatform/kit/ui';
import { actionPlanForEntry, type AppCardActionId } from './apps-card-actions.js';
import type { DesktopAppsEntry } from './apps-panel-projection.js';

export function useAppEntryMenu(input: {
  readonly entry: DesktopAppsEntry;
  readonly actionsDisabled: boolean;
  readonly removePending: boolean;
  readonly onAction: (action: AppCardActionId) => void;
}): { readonly menuItems: NimiMenuItem[]; readonly confirmElement: ReactElement } {
  const { entry, actionsDisabled, removePending, onAction } = input;
  const { t } = useTranslation();
  const actionPlan = actionPlanForEntry(entry);
  const [copiedAppId, setCopiedAppId] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const copyAppId = (): void => {
    void navigator.clipboard?.writeText(entry.identity.appId).then(() => {
      setCopiedAppId(true);
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => setCopiedAppId(false), 1_600);
    }).catch(() => {
      // Clipboard is a convenience; a rejected write needs no surface.
    });
  };

  const menuItems: NimiMenuItem[] = [
    {
      id: 'details',
      label: t('Apps.action.details'),
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => onAction('details'),
    },
    ...(actionPlan.primary ? [actionPlan.primary.id === 'stop'
      ? {
        id: 'stop',
        label: t('Apps.action.stop'),
        icon: <Square className="h-4 w-4" aria-hidden="true" />,
        disabled: actionsDisabled,
        onSelect: () => onAction('stop'),
      }
      : {
        id: 'launch',
        label: t(entry.committedRelease && entry.run?.state === 'running' ? 'Apps.action.focus' : 'Apps.action.launch'),
        icon: <Play className="h-4 w-4" aria-hidden="true" />,
        disabled: actionsDisabled,
        onSelect: () => onAction('launch'),
      }] : []),
    ...(actionPlan.primary?.id !== 'stop' && actionPlan.secondary.some((action) => action.id === 'stop') ? [{
      id: 'stop',
      label: t('Apps.action.stop'),
      icon: <Square className="h-4 w-4" aria-hidden="true" />,
      disabled: actionsDisabled,
      onSelect: () => onAction('stop'),
    }] : []),
    ...(actionPlan.secondary.some((action) => action.id === 'cancel-job') ? [{
      id: 'cancel-job',
      label: t('Apps.action.cancel'),
      icon: <X className="h-4 w-4" aria-hidden="true" />,
      disabled: actionsDisabled,
      onSelect: () => onAction('cancel-job'),
    }] : []),
    {
      id: 'copy-app-id',
      label: copiedAppId ? t('Apps.detail.appIdCopied') : t('Apps.detail.copyAppId'),
      icon: copiedAppId
        ? <Check className="h-4 w-4" aria-hidden="true" />
        : <Copy className="h-4 w-4" aria-hidden="true" />,
      onSelect: copyAppId,
    },
    ...(actionPlan.secondary.some((action) => action.id === 'remove') ? [{
      id: 'remove',
      label: t('Apps.action.removeDevelopment'),
      icon: <Trash2 className="h-4 w-4" aria-hidden="true" />,
      tone: 'danger' as const,
      disabled: actionsDisabled,
      onSelect: () => setConfirmingRemove(true),
    }] : []),
  ];

  const confirmElement = (
    <ConfirmDialog
      open={confirmingRemove}
      title={t('Apps.confirm.removeDevelopment.title')}
      message={t('Apps.confirm.removeDevelopment.message', { app: entry.identity.displayName })}
      confirmLabel={t('Apps.confirm.removeDevelopment.confirm')}
      cancelLabel={t('Common.cancel')}
      confirmTone="danger"
      pending={removePending}
      onConfirm={() => {
        setConfirmingRemove(false);
        onAction('remove');
      }}
      onClose={() => setConfirmingRemove(false)}
    />
  );

  return { menuItems, confirmElement };
}
