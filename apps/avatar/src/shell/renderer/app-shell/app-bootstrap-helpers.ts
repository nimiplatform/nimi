import {
  getAvatarLaunchContext,
  getRuntimeDefaults,
  installNimiShellRuntimeBridge,
  type AvatarLaunchContext,
  type NimiShellRuntimeBridgeResult,
} from '../bridge/index.js';
import type { AvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import { useAvatarStore } from './app-store.js';

export function readNormalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function installAvatarRuntimeBridge(): NimiShellRuntimeBridgeResult {
  return installNimiShellRuntimeBridge();
}

export function applyLaunchContextRuntimeDefaults(
  runtimeDefaults: Awaited<ReturnType<typeof getRuntimeDefaults>>,
  _launchContext: AvatarLaunchContext,
): Awaited<ReturnType<typeof getRuntimeDefaults>> {
  return runtimeDefaults;
}

export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function waitForAvatarLaunchContext(timeoutMs: number): Promise<AvatarLaunchContext> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await getAvatarLaunchContext();
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw new Error(`avatar launch context was not bound within ${timeoutMs}ms: ${errorMessage(lastError)}`);
}

export function resolveRuntimeAppId(_launchContext: AvatarLaunchContext): string {
  return 'nimi.avatar';
}

export type RuntimeExecutionBinding = {
  route: 'local' | 'cloud';
  modelId: string;
  connectorId?: string;
};

export type MockScenarioId =
  | 'default'
  | 'basic-emotion-cycle'
  | 'user-click-interaction'
  | 'continuous-eye-tracking'
  | 'sequence-greet'
  | 'posture-sync'
  | 'vrm-lifecycle'
  | 'vrm-context-lost'
  | 'vrm-listening'
  | 'vrm-thinking'
  | 'vrm-speaking-with-audio'
  | 'vrm-speaking-silent-audio'
  | 'vrm-emote-cycle';

export type LoadedMockScenarioFixture = {
  scenarioId: MockScenarioId;
  scenarioSource: `${MockScenarioId}.mock.json`;
  scenarioJson: string;
  activeWorldId: string;
  activeUserId: string;
  modelManifest: AvatarModelManifest | null;
};

const MOCK_SCENARIO_LOADERS = {
  'default': () => import('../mock/scenarios/default.mock.json?raw'),
  'basic-emotion-cycle': () => import('../mock/scenarios/basic-emotion-cycle.mock.json?raw'),
  'user-click-interaction': () => import('../mock/scenarios/user-click-interaction.mock.json?raw'),
  'continuous-eye-tracking': () => import('../mock/scenarios/continuous-eye-tracking.mock.json?raw'),
  'sequence-greet': () => import('../mock/scenarios/sequence-greet.mock.json?raw'),
  'posture-sync': () => import('../mock/scenarios/posture-sync.mock.json?raw'),
  'vrm-lifecycle': () => import('../mock/scenarios/vrm-lifecycle.mock.json?raw'),
  'vrm-context-lost': () => import('../mock/scenarios/vrm-context-lost.mock.json?raw'),
  'vrm-listening': () => import('../mock/scenarios/vrm-listening.mock.json?raw'),
  'vrm-thinking': () => import('../mock/scenarios/vrm-thinking.mock.json?raw'),
  'vrm-speaking-with-audio': () => import('../mock/scenarios/vrm-speaking-with-audio.mock.json?raw'),
  'vrm-speaking-silent-audio': () => import('../mock/scenarios/vrm-speaking-silent-audio.mock.json?raw'),
  'vrm-emote-cycle': () => import('../mock/scenarios/vrm-emote-cycle.mock.json?raw'),
} satisfies Record<MockScenarioId, () => Promise<{ default: string }>>;

const VRM_FIXTURE_MODEL_DIR = '.cache/assets/vrm-models/';
const VRM_FIXTURE_MODEL_DIR_URL_RAW = new URL(/* @vite-ignore */ '../../../../.cache/assets/vrm-models/', import.meta.url).href;
const VRM_FIXTURE_MODEL_DIR_URL = VRM_FIXTURE_MODEL_DIR_URL_RAW.endsWith('/')
  ? VRM_FIXTURE_MODEL_DIR_URL_RAW
  : `${VRM_FIXTURE_MODEL_DIR_URL_RAW}/`;

function isMockScenarioId(value: string): value is MockScenarioId {
  return Object.prototype.hasOwnProperty.call(MOCK_SCENARIO_LOADERS, value);
}

export function resolveMockScenarioId(value: unknown = import.meta.env['VITE_AVATAR_MOCK_SCENARIO']): MockScenarioId {
  const normalized = readNormalizedString(value);
  if (!normalized) return 'default';
  if (isMockScenarioId(normalized)) return normalized;
  throw new Error(`Unsupported VITE_AVATAR_MOCK_SCENARIO=${normalized}. Expected one of ${Object.keys(MOCK_SCENARIO_LOADERS).join(', ')}.`);
}

function requiredObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`mock scenario fixture ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  const normalized = readNormalizedString(value);
  if (!normalized) {
    throw new Error(`mock scenario fixture ${path} must be a non-empty string`);
  }
  return normalized;
}

function optionalString(value: unknown): string | null {
  return readNormalizedString(value) || null;
}

function isAbsolutePathOrUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/iu.test(value)
    || /^[a-z]:[\\/]/iu.test(value)
    || value.startsWith('/')
    || value.startsWith('\\\\');
}

function resolveFixtureAssetPath(value: unknown, path: string): string {
  const normalized = requiredString(value, path);
  if (isAbsolutePathOrUrl(normalized)) return normalized;
  const posix = normalized.replace(/\\/g, '/');
  if (posix === VRM_FIXTURE_MODEL_DIR.slice(0, -1)) {
    return VRM_FIXTURE_MODEL_DIR_URL;
  }
  if (posix.startsWith(VRM_FIXTURE_MODEL_DIR)) {
    return new URL(posix.slice(VRM_FIXTURE_MODEL_DIR.length), VRM_FIXTURE_MODEL_DIR_URL).href;
  }
  return normalized;
}

function extractLive2DManifest(raw: Record<string, unknown>): AvatarModelManifest {
  const live2d = requiredObject(raw['live2d'], 'model_manifest.live2d');
  return {
    kind: 'live2d',
    modelId: requiredString(raw['modelId'], 'model_manifest.modelId'),
    runtimeDir: resolveFixtureAssetPath(raw['runtimeDir'], 'model_manifest.runtimeDir'),
    nimiDir: optionalString(raw['nimiDir']),
    posterPath: optionalString(raw['posterPath']),
    live2d: {
      modelJson: resolveFixtureAssetPath(live2d['modelJson'], 'model_manifest.live2d.modelJson'),
      adapterManifestPath: optionalString(live2d['adapterManifestPath']),
      calibrationRef: optionalString(live2d['calibrationRef']),
    },
  };
}

function extractVrmManifest(raw: Record<string, unknown>): AvatarModelManifest {
  const vrm = requiredObject(raw['vrm'], 'model_manifest.vrm');
  return {
    kind: 'vrm',
    modelId: requiredString(raw['modelId'], 'model_manifest.modelId'),
    runtimeDir: resolveFixtureAssetPath(raw['runtimeDir'], 'model_manifest.runtimeDir'),
    nimiDir: optionalString(raw['nimiDir']),
    posterPath: optionalString(raw['posterPath']),
    vrm: {
      vrmFile: resolveFixtureAssetPath(vrm['vrmFile'], 'model_manifest.vrm.vrmFile'),
      motionPresetsDir: optionalString(vrm['motionPresetsDir']),
    },
  };
}

function extractMockScenarioModelManifest(raw: Record<string, unknown>): AvatarModelManifest | null {
  const vrmLifecycle = raw['vrm_lifecycle'];
  const vrmMockScenario = raw['vrm_mock_scenario'];
  const manifestRaw =
    optionalRecord(vrmLifecycle)?.['model_manifest']
    ?? optionalRecord(vrmMockScenario)?.['model_manifest'];
  if (manifestRaw === undefined || manifestRaw === null) return null;
  const manifest = requiredObject(manifestRaw, 'model_manifest');
  const kind = requiredString(manifest['kind'], 'model_manifest.kind');
  if (kind === 'live2d') return extractLive2DManifest(manifest);
  if (kind === 'vrm') return extractVrmManifest(manifest);
  throw new Error(`mock scenario fixture model_manifest.kind is not admitted: ${kind}`);
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseMockScenarioFixture(json: string, selectedScenarioId: MockScenarioId): LoadedMockScenarioFixture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(`mock scenario fixture ${selectedScenarioId}.mock.json is invalid JSON: ${errorMessage(error)}`);
  }
  const root = requiredObject(parsed, selectedScenarioId);
  const scenarioId = requiredString(root['scenario_id'], `${selectedScenarioId}.scenario_id`);
  if (scenarioId !== selectedScenarioId) {
    throw new Error(`mock scenario fixture id mismatch: expected ${selectedScenarioId}, got ${scenarioId}`);
  }
  const bootstrap = requiredObject(root['agent_bootstrap'], `${selectedScenarioId}.agent_bootstrap`);
  return {
    scenarioId: selectedScenarioId,
    scenarioSource: `${selectedScenarioId}.mock.json`,
    scenarioJson: json,
    activeWorldId: requiredString(bootstrap['active_world_id'], `${selectedScenarioId}.agent_bootstrap.active_world_id`),
    activeUserId: requiredString(bootstrap['active_user_id'], `${selectedScenarioId}.agent_bootstrap.active_user_id`),
    modelManifest: extractMockScenarioModelManifest(root),
  };
}

export async function loadDefaultMockScenarioJson(): Promise<string> {
  const fixture = await loadMockScenarioFixture('default');
  return fixture.scenarioJson;
}

export async function loadSelectedMockScenarioFixture(): Promise<LoadedMockScenarioFixture> {
  return loadMockScenarioFixture(resolveMockScenarioId());
}

export async function loadMockScenarioFixture(scenarioId: MockScenarioId): Promise<LoadedMockScenarioFixture> {
  const module = await MOCK_SCENARIO_LOADERS[scenarioId]();
  return parseMockScenarioFixture(module.default, scenarioId);
}

export function resolveExecutionBinding(input: {
  runtimeDefaults: ReturnType<typeof useAvatarStore.getState>['runtime']['defaults'];
  bundle: ReturnType<typeof useAvatarStore.getState>['bundle'];
}): RuntimeExecutionBinding | null {
  const executionBinding = input.bundle?.custom?.['execution_binding'];
  if (executionBinding && typeof executionBinding === 'object') {
    const record = executionBinding as Record<string, unknown>;
    const route = readNormalizedString(record.route);
    const modelId = readNormalizedString(record.modelId);
    const connectorId = readNormalizedString(record.connectorId);
    if ((route === 'local' || route === 'cloud') && modelId) {
      return {
        route,
        modelId,
        ...(connectorId ? { connectorId } : {}),
      };
    }
  }

  return null;
}
