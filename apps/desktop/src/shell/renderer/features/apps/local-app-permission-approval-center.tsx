import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  InlineAlert,
  NimiText,
  OverlayShell,
  ScrollArea,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';

import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import type { DesktopLocalAppPermissionRequest } from './local-app-permission-owner.js';

type DecisionState = 'pending' | 'denied';

export type LocalAppPermissionApprovalViewState =
  | 'hidden'
  | 'pending'
  | 'denied'
  | 'error';

export function resolveLocalAppPermissionApprovalViewState(input: {
  readonly hasRequest: boolean;
  readonly failed: boolean;
  readonly decisionState: DecisionState;
}): LocalAppPermissionApprovalViewState {
  if (!input.hasRequest) return 'hidden';
  if (input.failed) return 'error';
  if (input.decisionState === 'denied') return 'denied';
  return 'pending';
}

export function LocalAppPermissionApprovalCenter() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [requests, setRequests] = useState<readonly DesktopLocalAppPermissionRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState('');
  const [decisionState, setDecisionState] = useState<DecisionState>('pending');
  const request = requests[0] ?? null;

  const refresh = useCallback(async () => {
    try {
      setRequests(await bindings.app.commands.localAppPermissions.listPending());
      setFailed(false);
      setFailureMessage('');
    } catch (error) {
      setFailed(true);
      setFailureMessage(error instanceof Error ? error.message : String(error));
    }
  }, [bindings]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void refresh();
    void bindings.app.events.subscribeLocalAppPermissionRequests({
      onRequests(next) {
        if (!cancelled) {
          setRequests(next);
          setFailed(false);
        }
      },
      onError(error) {
        if (!cancelled) {
          setFailed(true);
          setFailureMessage(error instanceof Error ? error.message : String(error));
        }
      },
    }).then((value) => {
      if (cancelled) value();
      else unsubscribe = value;
    }).catch((error) => {
      if (!cancelled) {
        setFailed(true);
        setFailureMessage(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [bindings, refresh]);

  const submit = useCallback(async (approved: boolean) => {
    if (!request || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (approved) {
        await bindings.app.commands.localAppPermissions.approve({
          requestKey: request.requestKey,
          expectedOwnerRevision: request.ownerRevision,
        });
      } else {
        await bindings.app.commands.localAppPermissions.deny({
          requestKey: request.requestKey,
          expectedOwnerRevision: request.ownerRevision,
        });
        setDecisionState('denied');
      }
      setRequests((current) => current.filter((row) => row.requestKey !== request.requestKey));
      await refresh();
    } catch (error) {
      setFailed(true);
      setFailureMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [bindings, busy, refresh, request]);

  const viewState = resolveLocalAppPermissionApprovalViewState({
    hasRequest: Boolean(request),
    failed,
    decisionState,
  });
  if (!request) return null;

  return (
    <OverlayShell
      open
      kind="dialog"
      size="S"
      closeOnBackdrop={false}
      onClose={busy ? undefined : () => { void submit(false); }}
      dataTestId="local-app-permission-dialog"
      panelClassName={`max-h-[calc(100cqh-32px)] overflow-hidden flex flex-col permission-state-${viewState}`}
      contentClassName="min-h-0 flex flex-1 overflow-hidden"
      title={(
        <div className="flex min-w-0 items-start justify-between gap-3">
          <NimiText as="h2" role="section-title" className="min-w-0">
            {t('AppPermissions.approval.title', {
              app: request.displayAppId,
              defaultValue: `${request.displayAppId} requests to interact with your Agents`,
            })}
          </NimiText>
          <StatusBadge aria-hidden="true" tone="warning" shape="soft" className="shrink-0">
            {t('AppPermissions.posture.pending', { defaultValue: 'Pending' })}
          </StatusBadge>
        </div>
      )}
      description={(
        <NimiText role="helper" className="mt-1">
          {t('AppPermissions.approval.subtitle', {
            defaultValue: 'This grants access to every Agent in your account, including Agents you create later.',
          })}
        </NimiText>
      )}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            tone="danger"
            size="sm"
            disabled={busy}
            data-testid="local-app-permission-deny"
            onClick={() => { void submit(false); }}
          >
            {t('AppPermissions.action.deny', { defaultValue: 'Deny' })}
          </Button>
          <Button
            tone="primary"
            size="sm"
            loading={busy}
            disabled={busy}
            data-testid="local-app-permission-approve"
            onClick={() => { void submit(true); }}
          >
            {t('AppPermissions.action.approve', { defaultValue: 'Approve' })}
          </Button>
        </div>
      )}
    >
      <ScrollArea className="min-h-0 flex-1" contentClassName="grid gap-3 pb-2">
        <Surface tone="card" material="solid" padding="md" className="grid gap-2">
          <NimiText role="caption">{t('AppPermissions.field.app', { defaultValue: 'App' })}</NimiText>
          <p className="text-sm leading-5 text-[var(--nimi-text-primary)] break-words">
            {request.displayAppId}
          </p>
          <NimiText role="caption">{t('AppPermissions.field.reason', { defaultValue: 'Reason' })}</NimiText>
          <p className="text-sm leading-5 text-[var(--nimi-text-primary)] break-words">
            {request.reason}
          </p>
        </Surface>
        <Surface tone="card" material="solid" padding="md" className="grid gap-1">
          <NimiText role="card-title">
            {t('AppPermissions.scope.title', { defaultValue: 'All Agents in this account' })}
          </NimiText>
          <NimiText role="helper">
            {t('AppPermissions.scope.description', {
              defaultValue: 'Current and future Agents are included automatically. Revoking this permission removes access to all of them.',
            })}
          </NimiText>
        </Surface>
        {decisionState === 'denied' ? (
          <InlineAlert tone="warning">
            {t('AppPermissions.state.denied', { defaultValue: 'Request denied.' })}
          </InlineAlert>
        ) : null}
        {failed ? (
          <InlineAlert tone="danger">
            {import.meta.env?.DEV && failureMessage
              ? failureMessage
              : t('AppPermissions.state.error', {
                defaultValue: 'Permission management is unavailable. Try again.',
              })}
          </InlineAlert>
        ) : null}
        {requests.length > 1 ? (
          <NimiText role="caption">
            {t('AppPermissions.approval.queue', {
              count: requests.length,
              defaultValue: `${requests.length} requests waiting`,
            })}
          </NimiText>
        ) : null}
      </ScrollArea>
    </OverlayShell>
  );
}
