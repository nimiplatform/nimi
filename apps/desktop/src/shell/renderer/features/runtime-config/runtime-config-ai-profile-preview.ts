import type {
  NimiMachineLoadoutClient,
  NimiRuntimeLocalEnvironmentClient,
} from '@nimiplatform/sdk/runtime';

import {
  planRuntimeConfigAIProfileTransfer,
  type RuntimeConfigAIProfileTransferPlan,
} from './runtime-config-ai-profile-transfer.js';
import {
  summarizeDesktopPortableAIProfile,
  type DesktopPortableAIProfileSummary,
} from './runtime-config-portable-profile.js';

type PreviewModelAssets = Pick<
  NimiRuntimeLocalEnvironmentClient,
  'listModelAssets' | 'listVerifiedAssets'
>;

type PreviewLoadouts = Pick<NimiMachineLoadoutClient, 'get' | 'listRecipes'>;

export async function prepareRuntimeConfigAIProfilePreview(input: {
  readonly profile: Parameters<typeof planRuntimeConfigAIProfileTransfer>[0]['profile'];
  readonly modelAssets: PreviewModelAssets;
  readonly loadouts: PreviewLoadouts;
}): Promise<{
  readonly summary: DesktopPortableAIProfileSummary;
  readonly plan: RuntimeConfigAIProfileTransferPlan;
}> {
  const summary = summarizeDesktopPortableAIProfile(input.profile);
  const [assets, recipes, verifiedAssets, machine] = await Promise.all([
    input.modelAssets.listModelAssets(),
    input.loadouts.listRecipes(),
    input.modelAssets.listVerifiedAssets(),
    input.loadouts.get(),
  ]);
  const plan = await planRuntimeConfigAIProfileTransfer({
    profile: input.profile,
    assets,
    recipes,
    verifiedAssets,
    loadouts: machine.loadouts,
    selectedLoadoutIds: machine.selections.map((selection) => selection.loadoutId),
  });
  return Object.freeze({ summary, plan });
}
