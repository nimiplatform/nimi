import type { DesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/types';
import type { DesktopAvatarLiveInstanceRecord } from '@renderer/bridge/runtime-bridge/chat-agent-avatar-instance-registry';
import type { DesktopMacosSmokeAvatarEvidenceReadResult } from '@renderer/bridge/runtime-bridge/types';

export const SMOKE_STEP_TIMEOUT_MS = 15000;
export const SMOKE_BOOTSTRAP_TIMEOUT_MS = 60000;

export const LIVE2D_VIEWPORT_SELECTOR = '[data-avatar-live2d-status]';
export const VRM_VIEWPORT_SELECTOR = '[data-avatar-vrm-status]';

export type Live2dCanvasStats = {
  status: string | null;
  fallbackText: string | null;
  width: number;
  height: number;
  canvasPresent: boolean;
  contextKind: 'webgl2' | 'webgl' | null;
  sampleCount: number;
  nonTransparentSampleCount: number;
  sampleError: string | null;
  runtimeDebug: Record<string, unknown> | null;
};

export type VrmCanvasStats = Live2dCanvasStats & {
  stage: string | null;
};

export type DesktopMacosSmokeCanvasStats = {
  status: string | null;
  stage: string | null;
  fallbackText: string | null;
  width: number;
  height: number;
  canvasPresent: boolean;
  contextKind: 'webgl2' | 'webgl' | null;
  sampleCount: number;
  nonTransparentSampleCount: number;
  sampleError: string | null;
  runtimeDebug: Record<string, unknown> | null;
};

export type DesktopMacosSmokeDriverDeps = {
  waitForTestId: (id: string, timeoutMs?: number) => Promise<void>;
  waitForSelector: (selector: string, timeoutMs?: number) => Promise<void>;
  waitForSelectorGone: (selector: string, timeoutMs?: number) => Promise<void>;
  clickByTestId: (id: string, timeoutMs?: number) => Promise<void>;
  clickSelector: (selector: string, timeoutMs?: number) => Promise<void>;
  setValueBySelector: (selector: string, value: string, timeoutMs?: number) => Promise<void>;
  readLocalStorageItem: (key: string) => Promise<string | null>;
  verifyRuntimeAccountProjection: () => Promise<void>;
  clearAgentConversationAnchorBindings: () => Promise<void>;
  configureRuntimeTextRoute: () => Promise<void>;
  verifyRuntimeConversationAnchor: (input: { agentId: string; conversationAnchorId: string }) => Promise<void>;
  readRuntimeProductPathEvidence: (input: { agentId: string; conversationAnchorId: string }) => Promise<Record<string, unknown>>;
  setChatAvatarInteractionOverride: (override: Record<string, unknown> | null) => Promise<void>;
  resizeLive2dViewport: (size: { width: number; height: number }) => Promise<void>;
  pulseLive2dViewportTinyHost: () => Promise<void>;
  pulseLive2dDevicePixelRatio: (value: number) => Promise<void>;
  triggerLive2dContextLossAndRestore: () => Promise<void>;
  resizeVrmViewport: (size: { width: number; height: number }) => Promise<void>;
  pulseVrmViewportTinyHost: () => Promise<void>;
  triggerVrmContextLossAndRestore: () => Promise<void>;
  readTextByTestId: (id: string) => Promise<string>;
  readAttributeByTestId: (id: string, name: string) => Promise<string | null>;
  readLive2dCanvasStats: (selector: string) => Promise<Live2dCanvasStats>;
  readVrmCanvasStats: (selector: string) => Promise<VrmCanvasStats>;
  listAvatarLiveInstances: (agentId: string) => Promise<DesktopAvatarLiveInstanceRecord[]>;
  readAvatarEvidence: (avatarInstanceId: string) => Promise<DesktopMacosSmokeAvatarEvidenceReadResult>;
  writeReport: (payload: DesktopMacosSmokeReportPayload) => Promise<void>;
  currentRoute: () => string;
  currentHtml: () => string;
};

export type DesktopMacosSmokeReportPayload = {
  ok: boolean;
  failedStep?: string;
  steps: string[];
  errorMessage?: string;
  errorName?: string;
  errorStack?: string;
  errorCause?: string;
  route?: string;
  htmlSnapshot?: string;
  details?: Record<string, unknown>;
};

export type DesktopMacosSmokeFailureReportPayload = DesktopMacosSmokeReportPayload & {
  ok: false;
  failedStep: string;
  errorMessage: string;
  route: string;
  htmlSnapshot: string;
};

export type Live2dVisiblePixelsTimeoutError = Error & {
  live2dStats?: Live2dCanvasStats;
};

export type VrmVisiblePixelsTimeoutError = Error & {
  vrmStats?: VrmCanvasStats;
};

export type VrmRenderLoopEvidence = {
  frameCount: number;
  readyFrameCount: number;
  lastFrameAt: number | null;
  lastReadyFrameAt: number | null;
  canvasEpoch: number | null;
};

export type VrmFramingEvidence = {
  mode: string | null;
  selectionReason: string | null;
  scale: number | null;
  railWidth: number | null;
  railHeight: number | null;
  railAspect: number | null;
  railIsPortrait: boolean | null;
  fitHeight: number | null;
  fitWidth: number | null;
  fitDepth: number | null;
  targetTop: number | null;
  minBottom: number | null;
  zOffset: number | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  silhouetteAspect: number | null;
  widthRatio: number | null;
};

export type VrmFramingSignature = {
  mode: string;
  selectionReason: string;
  scale: number;
  fitHeight: number;
  fitWidth: number;
  fitDepth: number;
  targetTop: number;
  minBottom: number;
  zOffset: number;
  width: number;
  height: number;
  depth: number;
  silhouetteAspect: number;
  widthRatio: number;
};

export type VrmViewportStateEvidence = {
  phase: string | null;
  posture: string | null;
  speakingEnergy: number | null;
  mouthOpen: number | null;
  eyeOpen: number | null;
  blinkSpeed: number | null;
};

export type VrmExpressionEvidence = {
  activeViseme: string | null;
  speakingWeight: number | null;
  relaxedWeight: number | null;
};

export type VrmResourceCountsEvidence = {
  objectCount: number | null;
  meshCount: number | null;
  skinnedMeshCount: number | null;
  geometryCount: number | null;
  materialCount: number | null;
  textureCount: number | null;
  morphTargetCount: number | null;
};

export type VrmRendererMemoryEvidence = {
  geometries: number | null;
  textures: number | null;
  programs: number | null;
};

export type VrmPerformanceEvidence = {
  loadSuccessCount: number | null;
  disposeCount: number | null;
  disposedGeometryCount: number | null;
  disposedMaterialCount: number | null;
  disposedTextureCount: number | null;
  lastLoadedAssetRef: string | null;
  lastDisposedAssetRef: string | null;
  sceneResources: VrmResourceCountsEvidence | null;
  rendererMemory: VrmRendererMemoryEvidence | null;
};

export type WaitForVrmPostureEvidenceInput = {
  expectedPhase: string;
  expectedPosture: string;
  expectedActiveViseme: string | null;
  minSpeakingEnergy?: number;
  maxSpeakingEnergy?: number;
  minSpeakingWeight?: number;
  maxSpeakingWeight?: number;
  minRelaxedWeight?: number;
  mouthOpenMin?: number;
  mouthOpenMax?: number;
  eyeOpenMin?: number;
  eyeOpenMax?: number;
  blinkSpeedMin?: number;
  blinkSpeedMax?: number;
  errorLabel: string;
};

export function shouldStartDesktopMacosSmoke(input: {
  bootstrapReady: boolean;
  context: DesktopMacosSmokeContext | null;
  alreadyStarted: boolean;
}): boolean {
  return input.bootstrapReady
    && !input.alreadyStarted
    && Boolean(input.context?.enabled)
    && Boolean(input.context?.scenarioId);
}

export function isChatLive2dRenderSmokeScenario(scenarioId: string): boolean {
  return scenarioId === 'chat.live2d-render-smoke'
    || scenarioId === 'chat.live2d-render-smoke-mark'
    || scenarioId === 'chat.live2d-render-smoke-mark-speaking'
    || scenarioId.startsWith('chat.live2d-render-smoke-');
}

export function isChatVrmLifecycleSmokeScenario(scenarioId: string): boolean {
  return scenarioId === 'chat.vrm-lifecycle-smoke'
    || scenarioId === 'chat.vrm-lifecycle-smoke-avatar-sample-a'
    || scenarioId === 'chat.vrm-lifecycle-smoke-avatar-sample-b';
}
