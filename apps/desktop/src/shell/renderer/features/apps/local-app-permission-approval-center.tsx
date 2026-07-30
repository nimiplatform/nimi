import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
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
import {
  DESKTOP_AGENT_PERMISSION_IDS,
  DESKTOP_AGENT_PERMISSION_I18N_SEGMENTS,
  isDesktopDependentAgentPermission,
  type DesktopAgentPermissionId,
  type DesktopLocalAppPermissionProjection,
  type DesktopLocalAppPermissionRequest,
} from './local-app-permission-owner.js';

type DecisionState = 'pending' | 'denied';

export type LocalAppPermissionApprovalViewState =
  | 'hidden'
  | 'pending'
  | 'denied'
  | 'error';

export type DesktopLocalAppPermissionRequestGroup = {
  readonly requestKey: string;
  readonly displayAppId: string;
  readonly items: readonly DesktopLocalAppPermissionRequest[];
};

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

export function groupDesktopLocalAppPermissionRequests(
  requests: readonly DesktopLocalAppPermissionRequest[],
): readonly DesktopLocalAppPermissionRequestGroup[] {
  const groups = new Map<string, {
    displayAppId: string;
    items: DesktopLocalAppPermissionRequest[];
  }>();
  for (const request of requests) {
    const group = groups.get(request.requestKey);
    if (group && group.displayAppId !== request.displayAppId) {
      throw new Error('Desktop permission request grouping is ambiguous');
    }
    if (group) group.items.push(request);
    else groups.set(request.requestKey, { displayAppId: request.displayAppId, items: [request] });
  }
  const order = new Map(DESKTOP_AGENT_PERMISSION_IDS.map((permissionId, index) => [permissionId, index]));
  return [...groups.entries()].map(([requestKey, group]) => Object.freeze({
    requestKey,
    displayAppId: group.displayAppId,
    items: Object.freeze([...group.items].sort((left, right) => (
      (order.get(left.permissionId) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(right.permissionId) ?? Number.MAX_SAFE_INTEGER)
    ))),
  }));
}

export function hasEffectiveInteractGrant(
  projections: readonly DesktopLocalAppPermissionProjection[],
  requestKey: string,
): boolean {
  return projections.some((projection) => (
    projection.requestKey === requestKey
    && projection.permissionId === 'agents.interact'
    && projection.posture === 'granted'
  ));
}

export function LocalAppPermissionApprovalCenter() {
  const bindings = useDesktopRendererBindings();
  const [requests, setRequests] = useState<readonly DesktopLocalAppPermissionRequest[]>([]);
  const [projections, setProjections] = useState<readonly DesktopLocalAppPermissionProjection[]>([]);
  const [busyPermissionId, setBusyPermissionId] = useState<DesktopAgentPermissionId | null>(null);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState('');
  const [decisionState, setDecisionState] = useState<DecisionState>('pending');
  const requestGroups = useMemo(() => groupDesktopLocalAppPermissionRequests(requests), [requests]);
  const requestGroup = requestGroups[0] ?? null;

  const refreshProjections = useCallback(async () => {
    setProjections(await bindings.app.commands.localAppPermissions.listProjections());
  }, [bindings.app.commands.localAppPermissions]);

  const refresh = useCallback(async () => {
    try {
      const nextRequests = await bindings.app.commands.localAppPermissions.listPending();
      setRequests(nextRequests);
    } catch (error) {
      setFailed(true);
      setFailureMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      await refreshProjections();
      setFailed(false);
      setFailureMessage('');
    } catch (error) {
      setProjections([]);
      setFailed(true);
      setFailureMessage(error instanceof Error ? error.message : String(error));
    }
  }, [bindings.app.commands.localAppPermissions, refreshProjections]);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void refresh();
    void bindings.app.events.subscribeLocalAppPermissionRequests({
      onRequests(next) {
        if (!cancelled) {
          setRequests(next);
          setFailed(false);
          void refreshProjections().catch((error) => {
            if (!cancelled) {
              setFailed(true);
              setFailureMessage(error instanceof Error ? error.message : String(error));
            }
          });
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
  }, [bindings, refresh, refreshProjections]);

  const submit = useCallback(async (
    request: DesktopLocalAppPermissionRequest,
    approved: boolean,
  ) => {
    if (busyPermissionId) return;
    if (
      approved
      && isDesktopDependentAgentPermission(request.permissionId)
      && !hasEffectiveInteractGrant(projections, request.requestKey)
    ) return;
    setBusyPermissionId(request.permissionId);
    setFailed(false);
    try {
      const input = {
        requestKey: request.requestKey,
        permissionId: request.permissionId,
        expectedOwnerRevision: request.ownerRevision,
      };
      const nextProjection = approved
        ? await bindings.app.commands.localAppPermissions.approve(input)
        : await bindings.app.commands.localAppPermissions.deny(input);
      if (!approved) setDecisionState('denied');
      setRequests((current) => current.filter((row) => !(
        row.requestKey === request.requestKey && row.permissionId === request.permissionId
      )));
      setProjections((current) => [
        ...current.filter((row) => !(
          row.requestKey === nextProjection.requestKey
          && row.permissionId === nextProjection.permissionId
        )),
        nextProjection,
      ]);
      await refresh();
    } catch (error) {
      setFailed(true);
      setFailureMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyPermissionId(null);
    }
  }, [bindings.app.commands.localAppPermissions, busyPermissionId, projections, refresh]);

  if (!requestGroup) return null;
  const viewState = resolveLocalAppPermissionApprovalViewState({
    hasRequest: true,
    failed,
    decisionState,
  });
  const interactGranted = hasEffectiveInteractGrant(projections, requestGroup.requestKey);

  return (
    <LocalAppPermissionApprovalView
      requestGroup={requestGroup}
      waitingGroupCount={requestGroups.length}
      interactGranted={interactGranted}
      busyPermissionId={busyPermissionId}
      failed={failed}
      failureMessage={failureMessage}
      decisionState={decisionState}
      viewState={viewState}
      onDecision={(request, approved) => { void submit(request, approved); }}
      onClose={() => {
        const firstRequest = requestGroup.items[0];
        if (firstRequest) void submit(firstRequest, false);
      }}
    />
  );
}

export interface LocalAppPermissionApprovalViewProps {
  readonly requestGroup: DesktopLocalAppPermissionRequestGroup;
  readonly waitingGroupCount: number;
  readonly interactGranted: boolean;
  readonly busyPermissionId: DesktopAgentPermissionId | null;
  readonly failed: boolean;
  readonly failureMessage: string;
  readonly decisionState: DecisionState;
  readonly viewState: LocalAppPermissionApprovalViewState;
  readonly onDecision: (request: DesktopLocalAppPermissionRequest, approved: boolean) => void;
  readonly onClose: () => void;
}

export function LocalAppPermissionApprovalTitle({
  requestGroup,
}: {
  readonly requestGroup: DesktopLocalAppPermissionRequestGroup;
}): ReactElement {
  const { t } = useTranslation();
  const singleItem = requestGroup.items.length === 1;
  const onlyRequest = requestGroup.items[0];
  const onlyRequestSegment = onlyRequest
    ? DESKTOP_AGENT_PERMISSION_I18N_SEGMENTS[onlyRequest.permissionId]
    : null;
  return (
    <NimiText as="h2" role="section-title" className="min-w-0">
      {t(singleItem ? 'AppPermissions.approval.title' : 'AppPermissions.approval.combinedTitle', {
        app: requestGroup.displayAppId,
        count: requestGroup.items.length,
        permission: onlyRequestSegment
          ? t(`AppPermissions.intent.${onlyRequestSegment}`)
          : '',
      })}
    </NimiText>
  );
}

export function LocalAppPermissionApprovalView({
  requestGroup,
  waitingGroupCount,
  interactGranted,
  busyPermissionId,
  failed,
  failureMessage,
  decisionState,
  viewState,
  onDecision,
  onClose,
}: LocalAppPermissionApprovalViewProps): ReactElement {
  const { t } = useTranslation();
  const singleItem = requestGroup.items.length === 1;
  const onlyRequest = requestGroup.items[0];
  const anyBusy = busyPermissionId !== null;

  return (
    <OverlayShell
      open
      kind="dialog"
      size={singleItem ? 'S' : 'M'}
      closeOnBackdrop={false}
      onClose={anyBusy ? undefined : onClose}
      dataTestId="local-app-permission-dialog"
      panelClassName={`max-h-[calc(100cqh-32px)] overflow-hidden flex flex-col permission-state-${viewState}`}
      contentClassName="min-h-0 flex flex-1 overflow-hidden"
      title={(
        <div className="flex min-w-0 items-start justify-between gap-3">
          <LocalAppPermissionApprovalTitle requestGroup={requestGroup} />
          <StatusBadge aria-hidden="true" tone="warning" shape="soft" className="shrink-0">
            {t('AppPermissions.posture.pending')}
          </StatusBadge>
        </div>
      )}
      description={(
        <NimiText role="helper" className="mt-1">
          {t(singleItem ? 'AppPermissions.approval.subtitle' : 'AppPermissions.approval.combinedSubtitle')}
        </NimiText>
      )}
      footer={singleItem && onlyRequest ? (
        <LocalAppPermissionDecisionActions
          request={onlyRequest}
          compact={false}
          interactGranted={interactGranted}
          busyPermissionId={busyPermissionId}
          onDecision={onDecision}
        />
      ) : undefined}
    >
      <ScrollArea className="min-h-0 flex-1" contentClassName="grid gap-3 pb-2">
        <Surface tone="card" material="solid" padding="md" className="grid gap-2">
          <NimiText role="caption">{t('AppPermissions.field.app')}</NimiText>
          <p className="text-sm leading-5 text-[var(--nimi-text-primary)] break-words">
            {requestGroup.displayAppId}
          </p>
        </Surface>

        <LocalAppPermissionApprovalItems
          requests={requestGroup.items}
          singleItem={singleItem}
          interactGranted={interactGranted}
          busyPermissionId={busyPermissionId}
          onDecision={onDecision}
        />

        <Surface tone="card" material="solid" padding="md" className="grid gap-1">
          <NimiText role="card-title">{t('AppPermissions.scope.title')}</NimiText>
          <NimiText role="helper">{t('AppPermissions.scope.description')}</NimiText>
        </Surface>
        {decisionState === 'denied' ? (
          <InlineAlert tone="warning">{t('AppPermissions.state.denied')}</InlineAlert>
        ) : null}
        {failed ? (
          <InlineAlert tone="danger">
            {import.meta.env?.DEV && failureMessage
              ? failureMessage
              : t('AppPermissions.state.error')}
          </InlineAlert>
        ) : null}
        {waitingGroupCount > 1 ? (
          <NimiText role="caption">
            {t('AppPermissions.approval.queue', { count: waitingGroupCount })}
          </NimiText>
        ) : null}
      </ScrollArea>
    </OverlayShell>
  );
}

export interface LocalAppPermissionDecisionActionsProps {
  readonly request: DesktopLocalAppPermissionRequest;
  readonly compact: boolean;
  readonly interactGranted: boolean;
  readonly busyPermissionId: DesktopAgentPermissionId | null;
  readonly onDecision: (request: DesktopLocalAppPermissionRequest, approved: boolean) => void;
}

export function LocalAppPermissionDecisionActions({
  request,
  compact,
  interactGranted,
  busyPermissionId,
  onDecision,
}: LocalAppPermissionDecisionActionsProps): ReactElement {
  const { t } = useTranslation();
  const anyBusy = busyPermissionId !== null;
  const approveDisabled = anyBusy || (
    isDesktopDependentAgentPermission(request.permissionId) && !interactGranted
  );
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        tone="danger"
        size="sm"
        disabled={anyBusy}
        data-testid={compact
          ? `local-app-permission-deny-${request.permissionId}`
          : 'local-app-permission-deny'}
        onClick={() => onDecision(request, false)}
      >
        {t('AppPermissions.action.deny')}
      </Button>
      <Button
        tone="primary"
        size="sm"
        loading={busyPermissionId === request.permissionId}
        disabled={approveDisabled}
        data-testid={compact
          ? `local-app-permission-approve-${request.permissionId}`
          : 'local-app-permission-approve'}
        onClick={() => onDecision(request, true)}
      >
        {t('AppPermissions.action.approve')}
      </Button>
    </div>
  );
}

export interface LocalAppPermissionApprovalItemsProps {
  readonly requests: readonly DesktopLocalAppPermissionRequest[];
  readonly singleItem: boolean;
  readonly interactGranted: boolean;
  readonly busyPermissionId: DesktopAgentPermissionId | null;
  readonly onDecision: (request: DesktopLocalAppPermissionRequest, approved: boolean) => void;
}

export function LocalAppPermissionApprovalItems({
  requests,
  singleItem,
  interactGranted,
  busyPermissionId,
  onDecision,
}: LocalAppPermissionApprovalItemsProps): ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {requests.map((request) => {
        const segment = DESKTOP_AGENT_PERMISSION_I18N_SEGMENTS[request.permissionId];
        const dependent = isDesktopDependentAgentPermission(request.permissionId);
        return (
          <Surface
            key={request.permissionId}
            tone="card"
            material="solid"
            padding="md"
            className="grid gap-2"
            data-testid={`local-app-permission-item-${request.permissionId}`}
          >
            <NimiText role="card-title">{t(`AppPermissions.intent.${segment}`)}</NimiText>
            <NimiText role="helper">{t(`AppPermissions.intentDescription.${segment}`)}</NimiText>
            <NimiText role="caption">{t('AppPermissions.field.reason')}</NimiText>
            <p className="text-sm leading-5 text-[var(--nimi-text-primary)] break-words">
              {request.reason}
            </p>
            {dependent ? (
              <InlineAlert tone={interactGranted ? 'neutral' : 'warning'}>
                {t(interactGranted
                  ? 'AppPermissions.dependency.interactRequired'
                  : 'AppPermissions.dependency.interactMissing')}
              </InlineAlert>
            ) : null}
            {!singleItem ? (
              <LocalAppPermissionDecisionActions
                request={request}
                compact
                interactGranted={interactGranted}
                busyPermissionId={busyPermissionId}
                onDecision={onDecision}
              />
            ) : null}
          </Surface>
        );
      })}
    </>
  );
}
