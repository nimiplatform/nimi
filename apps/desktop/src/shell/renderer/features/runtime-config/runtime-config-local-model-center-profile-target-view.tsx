import { i18n } from '@renderer/i18n';
import { ScrollArea } from '@nimiplatform/kit/ui';
import type {
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileResolutionPlan,
} from '@nimiplatform/sdk/runtime';
import type {
  RuntimeConfigStateV11,
  RuntimeSetupPageIdV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import { ModelCenterProfileSection } from './runtime-config-model-center-profile-section';
import { resolveSelectedRuntimeProfileTarget } from './runtime-config-model-center-utils';

type ProfileTargetViewProps = {
  state: RuntimeConfigStateV11;
  selectedProfileTargetId: string;
  loadingProfilePlan: boolean;
  profileSelectionLocked: boolean;
  selectedProfileId: string;
  selectedProfileCapability: string;
  profilePlanPreview: LocalRuntimeProfileResolutionPlan | null;
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[];
  onSetSelectedProfileTargetId: (targetId: string) => void;
  onSetSelectedProfileId: (profileId: string) => void;
  onSetSelectedProfileCapability: (capability: string) => void;
  onResolveProfilePlanPreview: () => void;
  onApplyProfile: (targetId: string, profileId: string, capability?: string) => Promise<LocalRuntimeProfileApplyResult>;
  onNavigateToSetup?: (pageId: RuntimeSetupPageIdV11) => void;
};

export function LocalModelCenterProfileTargetView(props: ProfileTargetViewProps) {
  const targetCapabilities = props.runtimeProfileTargets.find((item) => item.targetId === props.selectedProfileTargetId)?.consumeCapabilities || [];
  const capabilityStatuses = targetCapabilities.map((capability) => {
    const localNode = props.state.local.nodeMatrix.find((node) => node.capability === capability && node.available);
    const hasLocalModel = props.state.local.models.some((model) => model.status === 'active' && model.capabilities.includes(capability));
    return { capability, localAvailable: Boolean(localNode) || hasLocalModel };
  });
  const hasUnavailable = capabilityStatuses.some((item) => !item.localAvailable);
  const selectedProfileTarget = resolveSelectedRuntimeProfileTarget(
    props.runtimeProfileTargets,
    props.selectedProfileTargetId,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center border-b border-[var(--nimi-border-subtle)] bg-white px-6">
        <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
          {i18n.t('runtimeConfig.localModelCenter.localModels', { defaultValue: 'Local Models' })}
        </h2>
      </div>
      <ScrollArea className="flex-1" contentClassName="space-y-6 p-6">
        <div className="space-y-4 rounded-2xl border border-[var(--nimi-border-subtle)]/70 bg-white/95 p-6 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
          <div>
            <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {selectedProfileTarget?.targetName
                || props.selectedProfileTargetId
                || i18n.t('runtimeConfig.localModelCenter.profileTarget', { defaultValue: 'Profile target' })}
            </h4>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.profileTargetProfilesDescription', {
                defaultValue: 'Configure this target&apos;s declared local AI profiles.',
              })}
            </p>
          </div>
          {targetCapabilities.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--nimi-text-secondary)]">
                {i18n.t('runtimeConfig.localModelCenter.aiCapabilityStatus', { defaultValue: 'AI Capability Status' })}
              </p>
              <div className="flex flex-wrap gap-2">
                {capabilityStatuses.map((item) => (
                  <span key={`cap-status-${item.capability}`} className={`rounded-full px-3 py-1 text-[11px] font-medium ${item.localAvailable ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]'}`}>
                    {item.capability}:{' '}
                    {item.localAvailable
                      ? i18n.t('runtimeConfig.localModelCenter.capabilityLocal', { defaultValue: 'local' })
                      : i18n.t('runtimeConfig.localModelCenter.capabilityNeedsSetup', { defaultValue: 'needs setup' })}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <ModelCenterProfileSection
            isProfileTargetMode
            loadingProfilePlan={props.loadingProfilePlan}
            selectedProfileTargetId={props.selectedProfileTargetId}
            profileSelectionLocked={props.profileSelectionLocked}
            selectedProfileId={props.selectedProfileId}
            selectedProfileCapability={props.selectedProfileCapability}
            selectedProfileTarget={selectedProfileTarget}
            executionPlanPreview={props.profilePlanPreview}
            runtimeProfileTargets={props.runtimeProfileTargets}
            onSetSelectedProfileTargetId={props.onSetSelectedProfileTargetId}
            onSetSelectedProfileId={props.onSetSelectedProfileId}
            onSetSelectedProfileCapability={props.onSetSelectedProfileCapability}
            onResolveProfilePlanPreview={props.onResolveProfilePlanPreview}
            onApplyProfile={props.onApplyProfile}
          />
        </div>
        {hasUnavailable ? (
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] p-5">
            <p className="text-xs font-semibold text-[var(--nimi-status-warning)]">
              {i18n.t('runtimeConfig.localModelCenter.setupRequired', { defaultValue: 'Setup Required' })}
            </p>
            <p className="mt-1 text-[11px] text-[var(--nimi-status-warning)]">
              {i18n.t('runtimeConfig.localModelCenter.setupRequiredDescription', {
                defaultValue: 'Some capabilities are not available locally. Install a local asset or configure a cloud API connector to enable them.',
              })}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={() => props.onNavigateToSetup?.('models')} className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_34%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]">
                {i18n.t('runtimeConfig.localModelCenter.installModels', { defaultValue: 'Install Models' })}
              </button>
              <button type="button" onClick={() => props.onNavigateToSetup?.('cloud')} className="px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]">
                {i18n.t('runtimeConfig.localModelCenter.configureCloudApi', { defaultValue: 'Configure Cloud API' })}
              </button>
            </div>
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}
