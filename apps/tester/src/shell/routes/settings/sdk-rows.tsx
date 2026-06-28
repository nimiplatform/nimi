import { StatusBadge } from '@nimiplatform/kit/ui';
import type { SettingsRouteViewProps } from './view';

const proofRowClassName = "flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)] before:mr-2 before:rounded before:border before:border-[var(--nimi-border-subtle)] before:px-1.5 before:py-0.5 before:text-[10px] before:font-semibold before:uppercase before:text-[var(--nimi-text-muted)] before:content-['Proof']";

export function SettingsSdkRows(props: SettingsRouteViewProps) {
  const {
    permissionClientProjection,
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
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK runtime health wire projection</span>
        <StatusBadge tone="neutral">
          {runtimeHealthWireProjection.statusName}: {runtimeHealthWireProjection.sampledAt}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK local runtime profile projection</span>
        <StatusBadge tone="neutral">
          {localRuntimeProfileProjection.profileCount}: {localRuntimeProfileProjection.runtimeEntryCount}/{localRuntimeProfileProjection.assetCount}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK local runtime execution plan projection</span>
        <StatusBadge tone="neutral">
          {localRuntimeExecutionPlanProjection.entries[0]?.kind ?? 'none'}: {localRuntimeExecutionPlanProjection.deviceProfile.arch}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK local runtime service/node projection</span>
        <StatusBadge tone={localRuntimeServiceNodeProjection.node.available ? 'success' : 'warning'}>
          {localRuntimeServiceNodeProjection.service.status}: {localRuntimeServiceNodeProjection.node.adapter}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK Nimi App bridge projection</span>
        <StatusBadge tone="neutral">
          {appBridgeProjection.registryRows[0]?.appId ?? 'none'}: {appBridgeProjection.releaseDescriptors[0]?.version ?? 'none'}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK account app-inventory projection</span>
        <StatusBadge tone="neutral">
          {accountAppInventoryProjection.accountId}: {accountAppInventoryProjection.apps[0]?.installState ?? 'none'} / {accountAppInventoryProjection.apps[0]?.accountState ?? 'none'}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK permission client projection</span>
        <StatusBadge tone={permissionClientProjection.status === 'ready' ? 'success' : permissionClientProjection.status === 'failed' ? 'danger' : 'warning'}>
          {permissionClientProjection.status === 'ready' && permissionClientProjection.data
            ? `${permissionClientProjection.data.scopeOwner}: ${permissionClientProjection.data.firstState}/${permissionClientProjection.data.requestState}/${permissionClientProjection.data.revokeState} (${permissionClientProjection.data.grantCount})`
            : permissionClientProjection.error ?? 'loading'}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK runtime audit wire projection</span>
        <StatusBadge tone="neutral">
          {runtimeAuditWireProjection.callerKindName}: {runtimeAuditWireProjection.usageWindowName}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>SDK runtime health coordinator projection</span>
        <StatusBadge tone={runtimeHealthCoordinatorProjection.stale ? 'warning' : 'success'}>
          {runtimeHealthCoordinatorProjection.started ? 'started' : 'not started'} / {runtimeHealthCoordinatorProjection.stale ? 'stale' : 'fresh'}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>Runtime media generation runner projection</span>
        <StatusBadge tone={runtimeMediaGenerationRunnerProjection.status === 'ready' && runtimeMediaGenerationRunnerProjection.projection.artifactCount === 1 ? 'success' : 'warning'}>
          {runtimeMediaGenerationRunnerProjection.status === 'ready'
            ? `${runtimeMediaGenerationRunnerProjection.projection.finalStatus} / artifacts=${runtimeMediaGenerationRunnerProjection.projection.artifactCount} / polls=${runtimeMediaGenerationRunnerProjection.projection.fallbackPollCount}`
            : runtimeMediaGenerationRunnerProjection.status}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>Runtime agent inspect projection</span>
        <StatusBadge tone={runtimeAgentInspectProjection.lifecycleStatus === 'active' ? 'success' : 'warning'}>
          {runtimeAgentInspectProjection.presentationBackend}
          {' / '}
          {runtimeAgentInspectProjection.nextHookStatus ?? 'none'}
          {' / '}
          {runtimeAgentInspectProjection.mutationKinds}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>Runtime external agent projection</span>
        <StatusBadge tone={externalAgentProjection.gateway.enabled ? 'success' : 'warning'}>
          {externalAgentProjection.issued.mode ?? 'none'}
          {' / '}
          {externalAgentProjection.token.tokenId}
          {' / '}
          {externalAgentProjection.gateway.actionCount}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>Runtime agent presentation profile projection</span>
        <StatusBadge tone={runtimeAgentPresentationProfileProjection.mutationKind === 'profile' ? 'success' : 'warning'}>
          {runtimeAgentPresentationProfileProjection.localAgentOwner}
          {' / '}
          {runtimeAgentPresentationProfileProjection.backendKind}
          {' / '}
          {runtimeAgentPresentationProfileProjection.defaultVoiceReference}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>Runtime struct codec projection</span>
        <StatusBadge tone={runtimeStructProjection.tagCount > 0 ? 'success' : 'warning'}>
          {runtimeStructProjection.surfaceId}: {runtimeStructProjection.auditKind} / {runtimeStructProjection.tagCount}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>Model picker binding projection</span>
        <StatusBadge tone={modelConfigBindingProjection ? 'success' : 'warning'}>
          {modelConfigBindingProjection?.source ?? 'none'}: {modelConfigBindingProjection?.model ?? 'missing'}
        </StatusBadge>
      </div>
      <div data-settings-row-kind="proof" className={proofRowClassName}>
        <span>Kit model binding summary projection</span>
        <StatusBadge tone={modelConfigBindingSummaryProjection.detail ? 'success' : 'warning'}>
          {modelConfigBindingSummaryProjection.label}: {modelConfigBindingSummaryProjection.detail ?? 'none'}
        </StatusBadge>
      </div>
    </>
  );
}
