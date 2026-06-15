import { StatusBadge } from '@nimiplatform/kit/ui';
import type { SettingsRouteViewProps } from './view';

export function SettingsSdkRows(props: SettingsRouteViewProps) {
  const {
    permissionClientProjection,
    runtimeAgentTurnRunnerProjection,
    runtimeMediaGenerationRunnerProjection,
    runtime: {
      runtimeHealthWireProjection,
      localRuntimeProfileProjection,
      localRuntimeExecutionPlanProjection,
      localRuntimeServiceNodeProjection,
      appBridgeProjection,
      accountAppInventoryProjection,
      runtimeAuditWireProjection,
      runtimeHealthCoordinatorProjection,
      runtimeAgentConsumerProjection,
      runtimeAgentInspectProjection,
      externalAgentProjection,
      runtimeAgentPresentationProfileProjection,
      runtimeStructProjection,
      modelConfigBindingProjection,
      modelConfigBindingSummaryProjection,
    },
  } = props;

  return (
    <>
      <div className="setting-row">
        <span>SDK runtime health wire projection</span>
        <StatusBadge tone="neutral">
          {runtimeHealthWireProjection.statusName}: {runtimeHealthWireProjection.sampledAt}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK local runtime profile projection</span>
        <StatusBadge tone="neutral">
          {localRuntimeProfileProjection.profileCount}: {localRuntimeProfileProjection.runtimeEntryCount}/{localRuntimeProfileProjection.assetCount}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK local runtime execution plan projection</span>
        <StatusBadge tone="neutral">
          {localRuntimeExecutionPlanProjection.entries[0]?.kind ?? 'none'}: {localRuntimeExecutionPlanProjection.deviceProfile.arch}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK local runtime service/node projection</span>
        <StatusBadge tone={localRuntimeServiceNodeProjection.node.available ? 'success' : 'warning'}>
          {localRuntimeServiceNodeProjection.service.status}: {localRuntimeServiceNodeProjection.node.adapter}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK Nimi App bridge projection</span>
        <StatusBadge tone="neutral">
          {appBridgeProjection.registryRows[0]?.appId ?? 'none'}: {appBridgeProjection.releaseDescriptors[0]?.version ?? 'none'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK account app-inventory projection</span>
        <StatusBadge tone="neutral">
          {accountAppInventoryProjection.accountId}: {accountAppInventoryProjection.apps[0]?.installState ?? 'none'} / {accountAppInventoryProjection.apps[0]?.accountState ?? 'none'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK permission client projection</span>
        <StatusBadge tone={permissionClientProjection.status === 'ready' ? 'success' : permissionClientProjection.status === 'failed' ? 'danger' : 'warning'}>
          {permissionClientProjection.status === 'ready' && permissionClientProjection.data
            ? `${permissionClientProjection.data.scopeOwner}: ${permissionClientProjection.data.firstState}/${permissionClientProjection.data.requestState}/${permissionClientProjection.data.revokeState} (${permissionClientProjection.data.grantCount})`
            : permissionClientProjection.error ?? 'loading'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK runtime audit wire projection</span>
        <StatusBadge tone="neutral">
          {runtimeAuditWireProjection.callerKindName}: {runtimeAuditWireProjection.usageWindowName}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>SDK runtime health coordinator projection</span>
        <StatusBadge tone={runtimeHealthCoordinatorProjection.stale ? 'warning' : 'success'}>
          {runtimeHealthCoordinatorProjection.started ? 'started' : 'not started'} / {runtimeHealthCoordinatorProjection.stale ? 'stale' : 'fresh'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime agent consumer projection</span>
        <StatusBadge tone={runtimeAgentConsumerProjection.projectionScoped ? 'success' : 'warning'}>
          {runtimeAgentConsumerProjection.projectionEventName}
          {' / '}
          {runtimeAgentConsumerProjection.timelineChannel}
          {' / '}
          {runtimeAgentConsumerProjection.recoveryEventCount}
          {' / '}
          {runtimeAgentConsumerProjection.terminalEventName}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime agent turn runner projection</span>
        <StatusBadge tone={runtimeAgentTurnRunnerProjection.status === 'ready' && runtimeAgentTurnRunnerProjection.projection.ignoredBacklog ? 'success' : 'warning'}>
          {runtimeAgentTurnRunnerProjection.status === 'ready'
            ? `${runtimeAgentTurnRunnerProjection.projection.sealedMessageId} / ${runtimeAgentTurnRunnerProjection.projection.outputText}`
            : runtimeAgentTurnRunnerProjection.status}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime media generation runner projection</span>
        <StatusBadge tone={runtimeMediaGenerationRunnerProjection.status === 'ready' && runtimeMediaGenerationRunnerProjection.projection.artifactCount === 1 ? 'success' : 'warning'}>
          {runtimeMediaGenerationRunnerProjection.status === 'ready'
            ? `${runtimeMediaGenerationRunnerProjection.projection.finalStatus} / artifacts=${runtimeMediaGenerationRunnerProjection.projection.artifactCount} / polls=${runtimeMediaGenerationRunnerProjection.projection.fallbackPollCount}`
            : runtimeMediaGenerationRunnerProjection.status}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime agent inspect projection</span>
        <StatusBadge tone={runtimeAgentInspectProjection.lifecycleStatus === 'active' ? 'success' : 'warning'}>
          {runtimeAgentInspectProjection.presentationBackend}
          {' / '}
          {runtimeAgentInspectProjection.nextHookStatus ?? 'none'}
          {' / '}
          {runtimeAgentInspectProjection.eventSummary ?? 'none'}
          {' / '}
          {runtimeAgentInspectProjection.mutationKinds}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime external agent projection</span>
        <StatusBadge tone={externalAgentProjection.gateway.enabled ? 'success' : 'warning'}>
          {externalAgentProjection.issued.mode ?? 'none'}
          {' / '}
          {externalAgentProjection.token.tokenId}
          {' / '}
          {externalAgentProjection.gateway.actionCount}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime agent presentation profile projection</span>
        <StatusBadge tone={runtimeAgentPresentationProfileProjection.mutationKind === 'profile' ? 'success' : 'warning'}>
          {runtimeAgentPresentationProfileProjection.localAgentOwner}
          {' / '}
          {runtimeAgentPresentationProfileProjection.backendKind}
          {' / '}
          {runtimeAgentPresentationProfileProjection.defaultVoiceReference}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Runtime struct codec projection</span>
        <StatusBadge tone={runtimeStructProjection.tagCount > 0 ? 'success' : 'warning'}>
          {runtimeStructProjection.surfaceId}: {runtimeStructProjection.auditKind} / {runtimeStructProjection.tagCount}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Model picker binding projection</span>
        <StatusBadge tone={modelConfigBindingProjection ? 'success' : 'warning'}>
          {modelConfigBindingProjection?.source ?? 'none'}: {modelConfigBindingProjection?.model ?? 'missing'}
        </StatusBadge>
      </div>
      <div className="setting-row">
        <span>Kit model binding summary projection</span>
        <StatusBadge tone={modelConfigBindingSummaryProjection.detail ? 'success' : 'warning'}>
          {modelConfigBindingSummaryProjection.label}: {modelConfigBindingSummaryProjection.detail ?? 'none'}
        </StatusBadge>
      </div>
    </>
  );
}
