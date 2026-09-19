import type { NimiJsonObject } from '@nimiplatform/sdk/contracts';
import type { NimiPortableAIProfile } from '@nimiplatform/sdk/ai';
import type { RuntimeConfigAIProfileTransferPlan } from './runtime-config-ai-profile-transfer.js';
import type {
  RuntimeSetupTaskDraftAxis,
  RuntimeSetupTaskPendingAxis,
  RuntimeSetupCloudRecommendation,
} from './runtime-setup-task-store.js';

/**
 * Maps a portable AIProfile capability subset into setup-task intents. The
 * classification keeps distinct failure modes apart — missing source,
 * unsupported recipe, missing resource, cloud-without-owner — so the UI can
 * report each capability truthfully instead of collapsing them into one
 * generic failure.
 */
// @nimi-authority: rule.nimi.desktop.ai-consumption.r026

export type RuntimeSetupProfileUseCapabilityState =
  /** Every axis is already on this machine; the candidate binds them exactly. */
  | 'ready'
  /** Some axes still need acquisition; they stay unbound until preparation. */
  | 'needs-acquisition'
  /** Content-known but no portable acquisition source (or hash mismatch). */
  | 'missing-source'
  /** Recipe unavailable or implementation mismatch with the current Runtime. */
  | 'unsupported'
  /** Local route without a portable Loadout intent. */
  | 'no-local-intent'
  /** Cloud intent: a machine-scope task never saves a global cloud default. */
  | 'cloud-requires-owner';

export type RuntimeSetupProfileUseCandidateInput = {
  readonly recipeId: string;
  readonly options: Readonly<NimiJsonObject>;
  readonly axes: readonly RuntimeSetupTaskDraftAxis[];
  /**
   * Download-required axes carry their declared content identity (contentId,
   * expectedHash, portable source) into the task draft so preparation
   * acquires exactly what the profile declares — never a substituted recipe
   * recommendation.
   */
  readonly pendingAxes: readonly RuntimeSetupTaskPendingAxis[];
  readonly displayName: string;
  readonly provenance: Readonly<Record<string, string>>;
};

export type RuntimeSetupProfileUseCapability = {
  readonly capabilityContract: string;
  readonly route: 'local' | 'cloud';
  readonly state: RuntimeSetupProfileUseCapabilityState;
  readonly reasonCode?: string;
  readonly candidate?: RuntimeSetupProfileUseCandidateInput;
  readonly cloudRecommendation?: RuntimeSetupCloudRecommendation;
};

export function planRuntimeSetupProfileUse(input: {
  readonly profile: NimiPortableAIProfile;
  /** Exact capability subset the user selected. */
  readonly subset: readonly string[];
  readonly transferPlan: RuntimeConfigAIProfileTransferPlan;
}): readonly RuntimeSetupProfileUseCapability[] {
  const result: RuntimeSetupProfileUseCapability[] = [];
  for (const rawContract of input.subset) {
    const capabilityContract = rawContract.trim();
    if (!capabilityContract) continue;
    const profileCapability = input.profile.capabilities[capabilityContract];
    if (!profileCapability) continue;
    if (profileCapability.route === 'cloud') {
      result.push(Object.freeze({
        capabilityContract,
        route: 'cloud' as const,
        state: 'cloud-requires-owner' as const,
        reasonCode: 'AI_PROFILE_CLOUD_REQUIRES_OWNER',
        cloudRecommendation: {
          implementation: profileCapability.implementation,
          providerModelTarget: profileCapability.providerModelTarget,
        },
      }));
      continue;
    }
    if (!profileCapability.loadout) {
      result.push(Object.freeze({
        capabilityContract,
        route: 'local' as const,
        state: 'no-local-intent' as const,
        reasonCode: 'AI_PROFILE_NO_LOCAL_LOADOUT_INTENT',
      }));
      continue;
    }
    const transferCapability = input.transferPlan.capabilities.find(
      (capability) => capability.capabilityContract === capabilityContract,
    );
    if (!transferCapability || transferCapability.state === 'upgrade-required') {
      result.push(Object.freeze({
        capabilityContract,
        route: 'local' as const,
        state: 'unsupported' as const,
        reasonCode: transferCapability?.reasonCode ?? 'AI_PROFILE_RECIPE_UPGRADE_REQUIRED',
      }));
      continue;
    }
    const missingSourceAxis = transferCapability.axes.find(
      (axis) => axis.state === 'content-only' || axis.state === 'hash-mismatch',
    );
    if (missingSourceAxis) {
      result.push(Object.freeze({
        capabilityContract,
        route: 'local' as const,
        state: 'missing-source' as const,
        reasonCode: missingSourceAxis.reasonCode ?? 'AI_PROFILE_MODEL_SOURCE_REQUIRED',
      }));
      continue;
    }
    // Only axes already verified on this machine bind exactly; download-needed
    // axes stay unbound (the legal unresolved state) but keep their declared
    // content identity on the draft so the reviewed preparation acquires and
    // binds exactly that content.
    const axes: RuntimeSetupTaskDraftAxis[] = transferCapability.axes.flatMap((axis) => (
      axis.state === 'matched' && axis.modelAssetId
        ? [{ slotId: axis.slotId, modelAssetId: axis.modelAssetId, expectedContentId: axis.contentId }]
        : []
    ));
    const pendingAxes: RuntimeSetupTaskPendingAxis[] = transferCapability.axes.flatMap((axis) => (
      axis.state === 'download-required'
        ? [{
          slotId: axis.slotId,
          contentId: axis.contentId,
          expectedHash: axis.expectedHash,
          ...(axis.templateId ? { templateId: axis.templateId } : {}),
          ...(axis.source
            ? {
              source: {
                repo: axis.source.repo,
                revision: axis.source.revision,
                file: axis.source.file,
                ...(axis.source.sizeBytes !== undefined ? { sizeBytes: axis.source.sizeBytes } : {}),
              },
            }
            : {}),
        }]
        : []
    ));
    const needsAcquisition = pendingAxes.length > 0;
    const recipeTitle = transferCapability.recipe?.title ?? transferCapability.recipeId;
    result.push(Object.freeze({
      capabilityContract,
      route: 'local' as const,
      state: needsAcquisition ? 'needs-acquisition' as const : 'ready' as const,
      candidate: Object.freeze({
        recipeId: transferCapability.recipeId,
        options: profileCapability.loadout.options,
        axes: Object.freeze(axes),
        pendingAxes: Object.freeze(pendingAxes),
        displayName: `${input.profile.title} · ${recipeTitle}`,
        provenance: Object.freeze({ source_profile_id: input.profile.profileId }),
      }),
    }));
  }
  return Object.freeze(result);
}
