import type { CubismCoreGlobal, CubismMocHandle, CubismModelHandle } from './cubism-runtime-types.js';
import type { OfficialCubismFrameworkRuntime } from './cubism-framework-runtime.js';
import type { Live2DCommandEvent } from './plugin-api.js';
import {
  loadModel3Settings,
  readBinaryFile,
  type Model3Settings,
  type ModelManifest,
} from './model-loader.js';
import {
  assertLive2DCompatibilitySupported,
  validateLive2DCompatibility,
  type Live2DAdapterManifestV1,
  type Live2DCompatibilityReport,
} from './compatibility.js';

export type Live2DBackendResources = {
  mocPath: string;
  texturePaths: string[];
  motionGroups: Map<string, string[]>;
  expressions: Map<string, string>;
  physicsPath: string | null;
  posePath: string | null;
  displayInfoPath: string | null;
};

export type Live2DBackendExecutionState = {
  loaded: boolean;
  activeMotion: string | null;
  activeExpression: string | null;
  activePose: string | null;
  parameters: Map<string, number>;
  commandLog: Live2DCommandEvent[];
};

export type Live2DFrameworkArtifacts = {
  modelSetting: InstanceType<OfficialCubismFrameworkRuntime['CubismModelSettingJson']> | null;
  motions: Map<string, unknown[]>;
  expressions: Map<string, unknown>;
  physics: unknown | null;
  pose: unknown | null;
};

export type Live2DBackendSession = {
  readonly manifest: ModelManifest;
  readonly settings: Model3Settings;
  readonly resources: Live2DBackendResources;
  readonly compatibility: Live2DCompatibilityReport;
  readonly framework: Live2DFrameworkArtifacts;
  readonly execution: Live2DBackendExecutionState;
  applyCommand(command: Live2DCommandEvent): void;
  unload(): void;
};

export type Live2DBackendDeps = {
  core: CubismCoreGlobal;
  framework: OfficialCubismFrameworkRuntime;
  readBinary?: (path: string) => Promise<ArrayBuffer>;
  adapterManifest?: Live2DAdapterManifestV1 | null;
};

function resolveRuntimeAsset(manifest: ModelManifest, relativePath: string, label: string): string {
  const value = relativePath.trim();
  if (!value) {
    throw new Error(`Live2D ${label} reference is empty`);
  }
  if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(`Live2D ${label} reference must be runtime-relative: ${relativePath}`);
  }
  const parts = value.split(/[\\/]+/);
  if (parts.some((part) => part === '..' || part === '.')) {
    throw new Error(`Live2D ${label} reference escapes runtime directory: ${relativePath}`);
  }
  return `${manifest.runtimeDir.replace(/[\\/]+$/, '')}/${parts.join('/')}`;
}

function collectMotionGroups(settings: Model3Settings, manifest: ModelManifest): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const motions = settings.FileReferences?.Motions ?? {};
  for (const [group, entries] of Object.entries(motions)) {
    groups.set(group, entries.map((entry) => resolveRuntimeAsset(manifest, entry.File, `motion ${group}`)));
  }
  return groups;
}

function collectExpressions(settings: Model3Settings, manifest: ModelManifest): Map<string, string> {
  const expressions = new Map<string, string>();
  for (const entry of settings.FileReferences?.Expressions ?? []) {
    expressions.set(entry.Name, resolveRuntimeAsset(manifest, entry.File, `expression ${entry.Name}`));
  }
  return expressions;
}

function collectResources(settings: Model3Settings, manifest: ModelManifest): Live2DBackendResources {
  const refs = settings.FileReferences;
  if (!refs?.Moc) {
    throw new Error(`model3.json missing FileReferences.Moc: ${manifest.model3JsonPath}`);
  }
  return {
    mocPath: resolveRuntimeAsset(manifest, refs.Moc, 'moc'),
    texturePaths: (refs.Textures ?? []).map((entry) => resolveRuntimeAsset(manifest, entry, 'texture')),
    motionGroups: collectMotionGroups(settings, manifest),
    expressions: collectExpressions(settings, manifest),
    physicsPath: refs.Physics ? resolveRuntimeAsset(manifest, refs.Physics, 'physics') : null,
    posePath: refs.Pose ? resolveRuntimeAsset(manifest, refs.Pose, 'pose') : null,
    displayInfoPath: refs.DisplayInfo ? resolveRuntimeAsset(manifest, refs.DisplayInfo, 'display info') : null,
  };
}

async function requireReadableAssets(
  resources: Live2DBackendResources,
  readBinary: (path: string) => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  const moc = await readBinary(resources.mocPath);
  await Promise.all(resources.texturePaths.map((path) => readBinary(path)));
  await Promise.all(Array.from(resources.motionGroups.values()).flat().map((path) => readBinary(path)));
  await Promise.all(Array.from(resources.expressions.values()).map((path) => readBinary(path)));
  await Promise.all([resources.physicsPath, resources.posePath, resources.displayInfoPath]
    .filter((path): path is string => typeof path === 'string')
    .map((path) => readBinary(path)));
  return moc;
}

async function createFrameworkArtifacts(
  settings: Model3Settings,
  resources: Live2DBackendResources,
  framework: OfficialCubismFrameworkRuntime,
  readBinary: (path: string) => Promise<ArrayBuffer>,
): Promise<Live2DFrameworkArtifacts> {
  const modelJsonBytes = new TextEncoder().encode(JSON.stringify(settings)).buffer;
  const modelSetting = new framework.CubismModelSettingJson(modelJsonBytes, modelJsonBytes.byteLength);
  const motions = new Map<string, unknown[]>();
  for (const [group, paths] of resources.motionGroups) {
    const created = [];
    for (const [index, path] of paths.entries()) {
      const bytes = await readBinary(path);
      const motion = framework.CubismMotion.create(bytes, bytes.byteLength);
      if (!motion) {
        throw new Error(`Live2D Cubism Framework rejected motion: ${path}`);
      }
      const fadeIn = modelSetting.getMotionFadeInTimeValue(group, index);
      if (fadeIn >= 0) motion.setFadeInTime(fadeIn);
      const fadeOut = modelSetting.getMotionFadeOutTimeValue(group, index);
      if (fadeOut >= 0) motion.setFadeOutTime(fadeOut);
      motion.setEffectIds([], []);
      created.push(motion);
    }
    motions.set(group, created);
  }
  const expressions = new Map<string, unknown>();
  for (const [name, path] of resources.expressions) {
    const bytes = await readBinary(path);
    const expression = framework.CubismExpressionMotion.create(bytes, bytes.byteLength);
    if (!expression) {
      throw new Error(`Live2D Cubism Framework rejected expression: ${path}`);
    }
    expressions.set(name, expression);
  }
  const physicsBytes = resources.physicsPath ? await readBinary(resources.physicsPath) : null;
  const physics = physicsBytes ? framework.CubismPhysics.create(physicsBytes, physicsBytes.byteLength) : null;
  if (resources.physicsPath && !physics) {
    throw new Error(`Live2D Cubism Framework rejected physics: ${resources.physicsPath}`);
  }
  const poseBytes = resources.posePath ? await readBinary(resources.posePath) : null;
  const pose = poseBytes ? framework.CubismPose.create(poseBytes, poseBytes.byteLength) : null;
  if (resources.posePath && !pose) {
    throw new Error(`Live2D Cubism Framework rejected pose: ${resources.posePath}`);
  }
  return { modelSetting, motions, expressions, physics, pose };
}

function createExecutionState(): Live2DBackendExecutionState {
  return {
    loaded: true,
    activeMotion: null,
    activeExpression: null,
    activePose: null,
    parameters: new Map(),
    commandLog: [],
  };
}

function requireLoaded(state: Live2DBackendExecutionState): void {
  if (!state.loaded) {
    throw new Error('Live2D backend session is not loaded');
  }
}

function applyCommand(
  resources: Live2DBackendResources,
  framework: Live2DFrameworkArtifacts,
  state: Live2DBackendExecutionState,
  command: Live2DCommandEvent,
): void {
  requireLoaded(state);
  switch (command.kind) {
    case 'motion': {
      if (!resources.motionGroups.has(command.group) || !framework.motions.has(command.group)) {
        throw new Error(`Live2D motion group not registered: ${command.group}`);
      }
      state.activeMotion = command.group;
      break;
    }
    case 'motion-stop':
      state.activeMotion = null;
      break;
    case 'parameter':
      state.parameters.set(command.id, command.value);
      break;
    case 'parameter-add':
      state.parameters.set(command.id, (state.parameters.get(command.id) ?? 0) + command.delta);
      break;
    case 'expression':
      if (!resources.expressions.has(command.id) || !framework.expressions.has(command.id)) {
        throw new Error(`Live2D expression not registered: ${command.id}`);
      }
      state.activeExpression = command.id;
      break;
    case 'expression-clear':
      state.activeExpression = null;
      break;
    case 'pose':
      if (!resources.posePath || !framework.pose) {
        throw new Error(`Live2D pose requested without pose3.json: ${command.group}`);
      }
      state.activePose = command.group;
      break;
    case 'pose-clear':
      state.activePose = null;
      break;
    default:
      command satisfies never;
  }
  state.commandLog.push(command);
}

export async function createLive2DBackendSession(
  manifest: ModelManifest,
  deps: Live2DBackendDeps,
): Promise<Live2DBackendSession> {
  const settings = await loadModel3Settings(manifest);
  const resources = collectResources(settings, manifest);
  const compatibility = validateLive2DCompatibility({
    model: manifest,
    settings,
    resources,
    adapter: deps.adapterManifest ?? null,
  });
  assertLive2DCompatibilitySupported(compatibility);
  const readBinary = deps.readBinary ?? readBinaryFile;
  const mocBytes = await requireReadableAssets(resources, readBinary);
  const framework = await createFrameworkArtifacts(settings, resources, deps.framework, readBinary);
  const moc: CubismMocHandle | null = deps.core.Moc.fromArrayBuffer(mocBytes);
  if (!moc) {
    throw new Error(`Live2D Cubism Core rejected MOC3 binary: ${resources.mocPath}`);
  }
  const model: CubismModelHandle | null = deps.core.Model.fromMoc(moc);
  if (!model) {
    moc._release?.();
    throw new Error(`Live2D Cubism Core failed to create model from MOC3: ${resources.mocPath}`);
  }
  const execution = createExecutionState();
  return {
    manifest,
    settings,
    resources,
    compatibility,
    framework,
    execution,
    applyCommand(command) {
      applyCommand(resources, framework, execution, command);
      model.update?.();
    },
    unload() {
      if (!execution.loaded) return;
      execution.loaded = false;
      execution.activeMotion = null;
      execution.activeExpression = null;
      execution.activePose = null;
      execution.parameters.clear();
      execution.commandLog.length = 0;
      model.release?.();
      moc._release?.();
    },
  };
}
