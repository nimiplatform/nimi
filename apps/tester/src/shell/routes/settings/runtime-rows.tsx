import { Button, StatusBadge } from '@nimiplatform/kit/ui';
import type { SettingsRouteViewProps } from './view';

export function SettingsRuntimeRows(props: SettingsRouteViewProps) {
  const {
    connectorProjection,
    refreshConnectorProjection,
    catalogProjection,
    refreshCatalogProjection,
    runtimeCapabilityProjection,
    runtimeProviderHealthProjection,
    runtimeRouteHostAccessProjection,
    localRuntimeFacadeProjection,
    realmDataSyncProjection,
    worldEvolutionSelectorReadProjection,
    realmSocialFeedProjection,
    realmAgentProfileProjection,
    realmAuthProjection,
    realmLocalAgentIntentsProjection,
    productControlProjection,
    runtime: {
      recommendationFeedProjection,
      recommendationFeedParserProjection,
      recommendationCopyProjection,
      runtimeReasonProjection,
      runtimeAgentRequestContextProjection,
      offlineReasonProjection,
      runtimeDependencyStateProjection,
      runtimeDependencyPlanProjection,
      runtimeDependencyJobProjection,
      firstRunProfileProjection,
      runtimeFirstRunMaterializationSummary,
      localRuntimeAssetIdProjection,
      localRuntimeAssetKindProjection,
      runtimeConfigProjection,
      runtimeTargetCallOptionsProjection,
      runtimeRequestMetadataProjection,
      runtimeLocalAiReasonProjection,
      memoryEmbeddingRouteProjection,
      runtimeAgentMemoryProjection,
      memoryEmbeddingRuntimeProjection,
      runtimeRouteModelProfileProjection,
      localRouteOptionProjection,
      runtimeRouteBindingMatchProjection,
      localRuntimeImageNativeEnvironmentPlanPayload,
      runtimeCapabilityCoverageProjection,
      runtimeRouteReasoningProjection,
      runtimeHealthSummaryProjection,
    },
  } = props;
  const runtimeTargetCallMetadata = runtimeTargetCallOptionsProjection.metadata ?? {};

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime recommendation projection</span>
        <StatusBadge tone="neutral">
          {recommendationFeedProjection.source} / {recommendationFeedProjection.cacheState} / {recommendationFeedProjection.grade} / {recommendationCopyProjection.detailCount} / {recommendationCopyProjection.feedSummary}: {recommendationCopyProjection.summary || recommendationCopyProjection.reason}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime recommendation feed parser</span>
        <StatusBadge tone="neutral">
          {recommendationFeedParserProjection.activeCapability} / {recommendationFeedParserProjection.items.length}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime connector projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={connectorProjection.status === 'error' ? 'danger' : 'info'}>
            {connectorProjection.status === 'ready'
              ? `${connectorProjection.connectors.length} connector${connectorProjection.connectors.length === 1 ? '' : 's'}`
              : connectorProjection.status === 'error'
                ? connectorProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={connectorProjection.status === 'loading'}
            onClick={() => {
              void refreshConnectorProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime model catalog projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={catalogProjection.status === 'error' ? 'danger' : 'info'}>
            {catalogProjection.status === 'ready'
              ? `${catalogProjection.providers[0]?.provider ?? 'none'} / ${catalogProjection.providers[0]?.source ?? 'unknown'}`
              : catalogProjection.status === 'error'
                ? catalogProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={catalogProjection.status === 'loading'}
            onClick={() => {
              void refreshCatalogProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime reason projection</span>
        <StatusBadge tone="neutral">
          {runtimeReasonProjection.reasonCode}: {runtimeReasonProjection.message} / {runtimeReasonProjection.credentialMissing} / {runtimeReasonProjection.numeric} / {runtimeReasonProjection.extracted} / {runtimeReasonProjection.presented}
          {' / '}
          {runtimeReasonProjection.traceId}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime LocalAgent identity projection</span>
        <StatusBadge tone="neutral">
          {runtimeAgentRequestContextProjection.localAgentRef}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Offline reason projection</span>
        <StatusBadge tone="neutral">
          {offlineReasonProjection.owner}: {offlineReasonProjection.reasonCode} / {offlineReasonProjection.errorOwner}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime dependency state projection</span>
        <StatusBadge tone={runtimeDependencyStateProjection.dependencyStartable ? 'info' : 'neutral'}>
          {runtimeDependencyStateProjection.dependencyStartable ? 'startable' : 'not startable'}
          {' / '}
          {runtimeDependencyStateProjection.jobActive ? 'active job' : 'settled job'}
          {' / '}
          {runtimeDependencyStateProjection.jobRetryable ? 'retryable job' : 'not retryable'}
          {' / '}
          {runtimeDependencyStateProjection.jobTransferring ? 'transferring job' : 'not transferring'}
          {' / '}
          {runtimeDependencyStateProjection.dependencyRepairRequired ? 'repair required' : 'repair clear'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime dependency parser projection</span>
        <StatusBadge tone={runtimeDependencyPlanProjection.dependencies[0]?.confirmationRequired ? 'warning' : 'neutral'}>
          {runtimeDependencyPlanProjection.packId}: {runtimeDependencyPlanProjection.dependencies[0]?.dependencyId ?? 'none'}
          {' / '}
          {runtimeDependencyJobProjection.percent}%
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>First-run materialization projection</span>
        <StatusBadge tone={runtimeFirstRunMaterializationSummary.retryableJobs > 0 ? 'warning' : 'neutral'}>
          {firstRunProfileProjection.minimal}/{firstRunProfileProjection.recommended}
          {' / '}
          retry {runtimeFirstRunMaterializationSummary.retryableJobs}
          {' / '}
          repair {runtimeFirstRunMaterializationSummary.repairableDependencies}
          {' / '}
          {runtimeFirstRunMaterializationSummary.productState}
          {' / '}
          {runtimeFirstRunMaterializationSummary.recoveryDisposition}
          {' / '}
          {runtimeFirstRunMaterializationSummary.percent ?? 'indeterminate'}%
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Local runtime asset id projection</span>
        <StatusBadge tone={localRuntimeAssetKindProjection.auxiliaryImportable ? 'success' : 'neutral'}>
          {localRuntimeAssetIdProjection.assetId} / {localRuntimeAssetIdProjection.lookupKey}
          {' / '}
          {localRuntimeAssetKindProjection.label}: {localRuntimeAssetKindProjection.runnableAssetKind}/{localRuntimeAssetKindProjection.dependencyAssetKind}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK local runtime facade projection</span>
        <StatusBadge tone={localRuntimeFacadeProjection.status === 'ready' ? 'success' : localRuntimeFacadeProjection.status === 'failed' ? 'danger' : 'warning'}>
          {localRuntimeFacadeProjection.status === 'ready'
            ? localRuntimeFacadeProjection.data
            : localRuntimeFacadeProjection.status === 'failed'
              ? localRuntimeFacadeProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK Realm data sync projection</span>
        <StatusBadge tone={realmDataSyncProjection.status === 'ready' ? 'success' : realmDataSyncProjection.status === 'failed' ? 'danger' : 'warning'}>
          {realmDataSyncProjection.status === 'ready'
            ? realmDataSyncProjection.data
            : realmDataSyncProjection.status === 'failed'
              ? realmDataSyncProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK World Evolution selector-read projection</span>
        <StatusBadge tone={worldEvolutionSelectorReadProjection.status === 'ready' ? 'success' : worldEvolutionSelectorReadProjection.status === 'failed' ? 'danger' : 'warning'}>
          {worldEvolutionSelectorReadProjection.status === 'ready' && worldEvolutionSelectorReadProjection.data
            ? `${worldEvolutionSelectorReadProjection.data.optionalReadCount}/${worldEvolutionSelectorReadProjection.data.missingEvidenceCategory}`
            : worldEvolutionSelectorReadProjection.status === 'failed'
              ? worldEvolutionSelectorReadProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK Realm social/feed projection</span>
        <StatusBadge tone={realmSocialFeedProjection.status === 'ready' ? 'success' : realmSocialFeedProjection.status === 'failed' ? 'danger' : 'warning'}>
          {realmSocialFeedProjection.status === 'ready' && realmSocialFeedProjection.data
            ? `${realmSocialFeedProjection.data.postScope}/${realmSocialFeedProjection.data.exploreCursor}/${realmSocialFeedProjection.data.mutationCount}`
            : realmSocialFeedProjection.status === 'failed'
              ? realmSocialFeedProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK Realm agent profile projection</span>
        <StatusBadge tone={realmAgentProfileProjection.status === 'ready' ? 'success' : realmAgentProfileProjection.status === 'failed' ? 'danger' : 'warning'}>
          {realmAgentProfileProjection.status === 'ready' && realmAgentProfileProjection.data
            ? `${realmAgentProfileProjection.data.agentId}/${realmAgentProfileProjection.data.creatorCount}/${realmAgentProfileProjection.data.createdOwnershipType}`
            : realmAgentProfileProjection.status === 'failed'
              ? realmAgentProfileProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK Realm auth projection</span>
        <StatusBadge tone={realmAuthProjection.status === 'ready' ? 'success' : realmAuthProjection.status === 'failed' ? 'danger' : 'warning'}>
          {realmAuthProjection.status === 'ready' && realmAuthProjection.data
            ? `${realmAuthProjection.data.entryRoute}/${realmAuthProjection.data.passwordLoginState}/${realmAuthProjection.data.projectedLoginState}`
            : realmAuthProjection.status === 'failed'
              ? realmAuthProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK Realm local-agent intents projection</span>
        <StatusBadge tone={realmLocalAgentIntentsProjection.status === 'ready' ? 'success' : realmLocalAgentIntentsProjection.status === 'failed' ? 'danger' : 'warning'}>
          {realmLocalAgentIntentsProjection.status === 'ready' && realmLocalAgentIntentsProjection.data
            ? `${realmLocalAgentIntentsProjection.data.provisionCount}/${realmLocalAgentIntentsProjection.data.terminationCount}/${realmLocalAgentIntentsProjection.data.ackedProvisionOutcome}/${realmLocalAgentIntentsProjection.data.ackedTerminationOutcome}`
            : realmLocalAgentIntentsProjection.status === 'failed'
              ? realmLocalAgentIntentsProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime call options projection / Runtime config projection</span>
        <StatusBadge tone={runtimeTargetCallMetadata.keySource === 'managed' ? 'success' : 'neutral'}>
          {runtimeTargetCallMetadata.callerId}: {runtimeTargetCallMetadata.traceId} / {runtimeConfigProjection.jwtIssuer}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime request metadata projection</span>
        <StatusBadge tone="neutral">
          {runtimeRequestMetadataProjection.keySource ?? 'direct'}: {runtimeRequestMetadataProjection.traceId}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime route host access projection</span>
        <StatusBadge tone={runtimeRouteHostAccessProjection.status === 'ready' ? 'success' : runtimeRouteHostAccessProjection.status === 'error' ? 'danger' : 'warning'}>
          {runtimeRouteHostAccessProjection.status === 'ready'
            ? `${runtimeRouteHostAccessProjection.projection.callerId}: ${runtimeRouteHostAccessProjection.projection.keySource}/${runtimeRouteHostAccessProjection.projection.healthStatus}`
            : runtimeRouteHostAccessProjection.status === 'error'
              ? runtimeRouteHostAccessProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime local AI reason projection</span>
        <StatusBadge tone={runtimeLocalAiReasonProjection === 'unknown' ? 'neutral' : 'warning'}>
          {runtimeLocalAiReasonProjection}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK product-control projection</span>
        <StatusBadge
          tone={productControlProjection.status === 'ready' && productControlProjection.data
            ? productControlProjection.data.degraded ? 'warning' : 'success'
            : productControlProjection.status === 'failed' ? 'danger' : 'warning'}
        >
          {productControlProjection.status === 'ready' && productControlProjection.data
            ? `${productControlProjection.data.runtimeMethod}: ${productControlProjection.data.state}: ${productControlProjection.data.screen}/${productControlProjection.data.admission} / data_root_selected=${productControlProjection.data.dataRootSelectedScreen} / ai_environment_unconfigured=${productControlProjection.data.aiEnvironmentScreen} / models=${productControlProjection.data.storageDirs.localModelsDir} / logs=${productControlProjection.data.storageDirs.logsDir}`
            : productControlProjection.status === 'failed'
              ? productControlProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK local image runtime dependency projection</span>
        <StatusBadge tone="neutral">
          {localRuntimeImageNativeEnvironmentPlanPayload.packId}: {localRuntimeImageNativeEnvironmentPlanPayload.consumerScope}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Memory embedding route projection</span>
        <StatusBadge tone={memoryEmbeddingRouteProjection.state === 'ready' ? 'success' : 'warning'}>
          {memoryEmbeddingRouteProjection.sourceKind ?? 'none'}: {memoryEmbeddingRouteProjection.reason}
          {' / '}
          {memoryEmbeddingRuntimeProjection.agentId}: {memoryEmbeddingRuntimeProjection.resolutionState}/{memoryEmbeddingRuntimeProjection.bindOutcome}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime agent memory projection</span>
        <StatusBadge tone={runtimeAgentMemoryProjection.mode === 'standard' ? 'success' : 'warning'}>
          {runtimeAgentMemoryProjection.mode}: {runtimeAgentMemoryProjection.embeddingProfileModelId ?? 'none'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Local route option projection</span>
        <StatusBadge tone={localRouteOptionProjection.selectable ? 'success' : 'warning'}>
          {localRouteOptionProjection.binding.source}: {localRouteOptionProjection.binding.localModelId}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime route binding match projection</span>
        <StatusBadge tone={runtimeRouteBindingMatchProjection ? 'success' : 'warning'}>
          {runtimeRouteBindingMatchProjection ? 'matched' : 'not matched'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime route model profile projection</span>
        <StatusBadge tone={runtimeRouteModelProfileProjection ? 'success' : 'warning'}>
          {runtimeRouteModelProfileProjection
            ? `${runtimeRouteModelProfileProjection.model}: ${runtimeRouteModelProfileProjection.maxOutputTokens ?? 'unknown'}`
            : 'unavailable'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime capability coverage projection</span>
        <StatusBadge tone={runtimeCapabilityCoverageProjection.cloudAvailable ? 'success' : 'warning'}>
          {runtimeCapabilityCoverageProjection.capability}: {runtimeCapabilityCoverageProjection.cloudAvailable ? 'cloud' : 'unavailable'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime route capability projection</span>
        <StatusBadge tone={runtimeCapabilityProjection.status === 'ready' && runtimeCapabilityProjection.summary.supported ? 'success' : runtimeCapabilityProjection.status === 'error' ? 'danger' : 'warning'}>
          {runtimeCapabilityProjection.status === 'ready'
            ? `${runtimeCapabilityProjection.summary.capability}: ${runtimeCapabilityProjection.summary.ready ? 'ready' : runtimeCapabilityProjection.summary.issueKind}/${runtimeCapabilityProjection.summary.setupStatus}/${runtimeCapabilityProjection.summary.reasonCode}`
            : runtimeCapabilityProjection.status === 'error'
              ? runtimeCapabilityProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime route reasoning projection</span>
        <StatusBadge tone={runtimeRouteReasoningProjection.supported ? 'success' : 'warning'}>
          {runtimeRouteReasoningProjection.reason}: {runtimeRouteReasoningProjection.traceMode}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Runtime route provider health projection</span>
        <StatusBadge tone={runtimeProviderHealthProjection.status === 'ready' && runtimeProviderHealthProjection.health.status === 'healthy' ? 'success' : runtimeProviderHealthProjection.status === 'error' ? 'danger' : 'warning'}>
          {runtimeProviderHealthProjection.status === 'ready'
            ? `${runtimeProviderHealthProjection.health.model}: ${runtimeProviderHealthProjection.health.status}`
            : runtimeProviderHealthProjection.status === 'error'
              ? runtimeProviderHealthProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK runtime health summary projection</span>
        <StatusBadge tone={runtimeHealthSummaryProjection.normalizedStatus === 'healthy' ? 'success' : 'warning'}>
          {runtimeHealthSummaryProjection.normalizedStatus}: {runtimeHealthSummaryProjection.health.checkedAt}
        </StatusBadge>
      </div>
    </>
  );
}
