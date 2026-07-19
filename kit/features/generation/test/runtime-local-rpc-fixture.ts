import type { NimiRuntimeLocalModelCenterRpc } from '@nimiplatform/kit/core/sdk-contract';
import { RuntimeReasonCode } from '@nimiplatform/kit/core/sdk-contract';

type LocalAssetRecordFixture = Awaited<ReturnType<NimiRuntimeLocalModelCenterRpc['listLocalAssets']>>['assets'][number];

const unconfiguredLocalOperation = async (): Promise<never> => {
  throw new Error('Runtime local RPC fixture operation is not configured');
};

const unconfiguredLocalStream = async function* (): AsyncIterable<never> {
  throw new Error('Runtime local RPC fixture stream is not configured');
};

const LOCAL_ASSET_KIND = {
  chat: 1,
  image: 2,
  video: 3,
  tts: 4,
  stt: 5,
  embedding: 6,
  vae: 10,
  clip: 11,
  lora: 12,
  controlnet: 13,
  auxiliary: 14,
} as const;

export function createLocalAssetRecordFixture(input: {
  readonly localAssetId: string;
  readonly assetId: string;
  readonly kind: keyof typeof LOCAL_ASSET_KIND;
  readonly engine: string;
}): LocalAssetRecordFixture {
  return {
    localAssetId: input.localAssetId,
    assetId: input.assetId,
    kind: LOCAL_ASSET_KIND[input.kind],
    engine: input.engine,
    entry: '',
    files: [],
    license: '',
    hashes: {},
    status: 2,
    installedAt: '',
    updatedAt: '',
    healthDetail: '',
    capabilities: [],
    logicalModelId: '',
    family: '',
    artifactRoles: [],
    preferredEngine: '',
    fallbackEngines: [],
    bundleState: 0,
    warmState: 0,
    localInvokeProfileId: '',
    endpoint: '',
    reasonCode: RuntimeReasonCode.REASON_CODE_UNSPECIFIED,
    displayName: '',
    sourceFileName: '',
    importInstanceId: '',
  };
}

export function createRuntimeLocalRpcFixture(
  overrides: Partial<NimiRuntimeLocalModelCenterRpc> = {},
): NimiRuntimeLocalModelCenterRpc {
  return {
    applyProfile: unconfiguredLocalOperation,
    cancelLocalEnvironmentDependencyJob: unconfiguredLocalOperation,
    cancelLocalTransfer: unconfiguredLocalOperation,
    checkLocalAssetHealth: unconfiguredLocalOperation,
    collectDeviceProfile: unconfiguredLocalOperation,
    getRecommendationFeed: unconfiguredLocalOperation,
    importLocalAsset: unconfiguredLocalOperation,
    importLocalAssetBundle: unconfiguredLocalOperation,
    importLocalAssetFile: unconfiguredLocalOperation,
    installModelFromPlan: unconfiguredLocalOperation,
    installVerifiedAsset: unconfiguredLocalOperation,
    listCatalogVariants: unconfiguredLocalOperation,
    listLocalAssets: unconfiguredLocalOperation,
    listLocalEnvironmentDependencyJobs: unconfiguredLocalOperation,
    listLocalTransfers: unconfiguredLocalOperation,
    listVerifiedAssets: unconfiguredLocalOperation,
    pauseLocalTransfer: unconfiguredLocalOperation,
    removeLocalAsset: unconfiguredLocalOperation,
    repairLocalEnvironmentDependency: unconfiguredLocalOperation,
    rescanLocalAssetBundle: unconfiguredLocalOperation,
    resolveLocalEnvironmentPlan: unconfiguredLocalOperation,
    resolveModelInstallPlan: unconfiguredLocalOperation,
    resolveProfile: unconfiguredLocalOperation,
    resumeLocalTransfer: unconfiguredLocalOperation,
    retryLocalEnvironmentDependencyJob: unconfiguredLocalOperation,
    scaffoldOrphanAsset: unconfiguredLocalOperation,
    scanUnregisteredAssets: unconfiguredLocalOperation,
    searchCatalogModels: unconfiguredLocalOperation,
    startLocalAsset: unconfiguredLocalOperation,
    startLocalEnvironmentDependencyJob: unconfiguredLocalOperation,
    stopLocalAsset: unconfiguredLocalOperation,
    watchLocalTransfers: unconfiguredLocalStream,
    ...overrides,
  };
}
