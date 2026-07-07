import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserWindow, IpcMain } from 'electron';
import { dialog } from 'electron';
import { findLive2dModelEntries } from './live2d-source.js';
import {
  assertSameScope,
  createDefaultConfig,
  normalizeText,
  parseAvatarAssetId,
  parseAvatarKind,
  parseBackgroundAssetId,
  parseConfig,
  parseRequiredString,
  parseScope,
  type AgentCenterAvatarAssetKind,
  type AgentCenterLocalConfig,
  type AvatarImportState,
  type AvatarValidationResult,
  type BackgroundImportState,
  type BackgroundValidationResult,
  type LocalConfigScope,
  type ValidationIssue,
} from './agent-center-local-config-schema.js';

/**
 * Resolves an absolute local asset path to a shell-served asset URL. Injected by
 * `main.ts` from the kit `nimi-shell-file` protocol host so that renderer-facing
 * asset URLs never expose a raw `file://` scheme (P-KIT-041C).
 */
export type ZhiyuLocalAssetUrlResolver = (absolutePath: string) => Promise<string> | string;

const CHANNEL = 'zhiyu:agent-center-local-config';
const ALLOWED_AVATAR_COMMANDS = new Set([
  'config.get',
  'config.put',
  'avatar.pickLive2dSource',
  'avatar.pickVrmSource',
  'avatar.import',
  'avatar.validate',
  'avatar.pickLive2dAdapterManifest',
  'avatar.importLive2dAdapterManifest',
  'background.pickSource',
  'background.import',
  'background.get',
  'background.remove',
]);

export function registerZhiyuAgentCenterLocalConfigBridge(input: {
  ipcMain: IpcMain;
  dataRoot: string;
  isAllowedRendererUrl: (url: string) => boolean;
  mainWindow: () => BrowserWindow | undefined;
  resolveLocalAssetUrl: ZhiyuLocalAssetUrlResolver;
}): void {
  input.ipcMain.handle(CHANNEL, async (event, message) => {
    const senderUrl = event.senderFrame?.url || event.sender.getURL();
    if (!input.isAllowedRendererUrl(senderUrl)) {
      throw new Error('Zhiyu Agent Center local config bridge denied renderer origin.');
    }
    const envelope = asRecord(message, 'Zhiyu Agent Center bridge message');
    const command = normalizeText(envelope.command);
    if (!ALLOWED_AVATAR_COMMANDS.has(command)) {
      throw new Error(`Unsupported Zhiyu Agent Center local config command: ${command || 'missing'}`);
    }
    const payload = asRecord(envelope.payload ?? {}, 'Zhiyu Agent Center bridge payload');
    return dispatchAgentCenterCommand({
      command,
      payload,
      dataRoot: input.dataRoot,
      window: input.mainWindow(),
      resolveLocalAssetUrl: input.resolveLocalAssetUrl,
    });
  });
}

async function dispatchAgentCenterCommand(input: {
  command: string;
  payload: Record<string, unknown>;
  dataRoot: string;
  window: BrowserWindow | undefined;
  resolveLocalAssetUrl: ZhiyuLocalAssetUrlResolver;
}): Promise<unknown> {
  if (input.command === 'config.get') {
    return getConfig(input.dataRoot, parseScope(input.payload));
  }
  if (input.command === 'config.put') {
    const config = parseConfig(input.payload.config);
    await writeConfig(input.dataRoot, config);
    return config;
  }
  if (input.command === 'avatar.pickLive2dSource') {
    return pickLive2dSource(input.window);
  }
  if (input.command === 'avatar.pickVrmSource') {
    return pickVrmSource(input.window);
  }
  if (input.command === 'avatar.import') {
    return importAvatarAsset(input.dataRoot, input.payload);
  }
  if (input.command === 'avatar.validate') {
    const scope = parseScope(input.payload);
    const localAssetId = parseAvatarAssetId(input.payload.localAssetId, 'localAssetId');
    return validateAvatarAsset(input.dataRoot, scope, localAssetId);
  }
  if (input.command === 'avatar.pickLive2dAdapterManifest') {
    return pickLive2dAdapterManifest(input.window);
  }
  if (input.command === 'avatar.importLive2dAdapterManifest') {
    return importLive2dAdapterManifest(input.dataRoot, input.payload);
  }
  if (input.command === 'background.pickSource') {
    return pickBackgroundSource(input.window);
  }
  if (input.command === 'background.import') {
    return importBackground(input.dataRoot, input.payload);
  }
  if (input.command === 'background.get') {
    const scope = parseScope(input.payload);
    const backgroundAssetId = parseBackgroundAssetId(input.payload.backgroundAssetId, 'backgroundAssetId');
    return getBackgroundAsset(input.dataRoot, scope, backgroundAssetId, input.resolveLocalAssetUrl);
  }
  if (input.command === 'background.remove') {
    return removeBackground(input.dataRoot, input.payload);
  }
  throw new Error(`Unsupported Zhiyu Agent Center local config command: ${input.command}`);
}

async function pickLive2dSource(window: BrowserWindow | undefined): Promise<string | null> {
  const result = await showOpenDialog(window, {
    title: '导入 Live2D 文件夹',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function pickVrmSource(window: BrowserWindow | undefined): Promise<string | null> {
  const result = await showOpenDialog(window, {
    title: '导入 VRM 文件',
    properties: ['openFile'],
    filters: [{ name: 'VRM', extensions: ['vrm'] }],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function pickLive2dAdapterManifest(window: BrowserWindow | undefined): Promise<string | null> {
  const result = await showOpenDialog(window, {
    title: '导入 Live2D adapter manifest',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

async function pickBackgroundSource(window: BrowserWindow | undefined): Promise<string | null> {
  const result = await showOpenDialog(window, {
    title: '导入背景图片',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif'] }],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

function showOpenDialog(window: BrowserWindow | undefined, options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

async function importAvatarAsset(dataRoot: string, payload: Record<string, unknown>): Promise<unknown> {
  const scope = parseScope(payload);
  const kind = parseAvatarKind(payload.kind);
  const sourcePath = await resolveExistingPath(parseRequiredString(payload.sourcePath, 'sourcePath'), 'sourcePath');
  const sourceStat = await fs.stat(sourcePath);
  if (kind === 'live2d' && !sourceStat.isDirectory()) {
    throw new Error('Live2D Avatar import requires a source directory.');
  }
  if (kind === 'vrm' && !sourceStat.isFile()) {
    throw new Error('VRM Avatar import requires a source file.');
  }
  if (kind === 'vrm' && path.extname(sourcePath).toLowerCase() !== '.vrm') {
    throw new Error('VRM Avatar import only admits .vrm files.');
  }
  if (kind === 'live2d') {
    await assertLive2dSource(sourcePath);
  }

  const localAssetId = `${kind}_${randomHex(12)}`;
  const assetDir = avatarAssetDir(dataRoot, scope, localAssetId);
  await fs.mkdir(assetDir, { recursive: true });
  if (kind === 'live2d') {
    await copyDirectory(sourcePath, path.join(assetDir, 'package'));
  } else {
    await fs.copyFile(sourcePath, path.join(assetDir, 'package.vrm'));
  }
  const materializationRef = `zhiyu.agent_center.avatar_asset:${localAssetId}`;
  const backendCapabilityProfileRef = `avatar.backend_profile:${kind}:${localAssetId}:import_validated`;
  await writeJson(path.join(assetDir, 'asset.manifest.json'), {
    schema_version: 1,
    local_asset_id: localAssetId,
    backend_kind: kind,
    source_basename: path.basename(sourcePath),
    materialization_ref: materializationRef,
    backend_capability_profile_ref: backendCapabilityProfileRef,
    imported_at: nowIso(),
  });
  const validation = await validateAvatarAsset(dataRoot, scope, localAssetId);
  if (payload.select !== false) {
    const config = await getConfig(dataRoot, scope);
    config.modules.avatar_asset = {
      ...config.modules.avatar_asset,
      local_avatar_asset_ref: localAssetId,
      live2d_adapter_manifest_source: 'none',
      live2d_adapter_manifest_ref: null,
      live2d_calibration_ref: null,
      backend_kind: kind,
      backend_capability_profile_ref: backendCapabilityProfileRef,
      updated_at: nowIso(),
      provenance: {
        source: 'import_validation',
        evidence_ref: validation.status === 'valid' ? validation.local_asset_id : 'zhiyu-avatar-import-validation-failed',
      },
    };
    await writeConfig(dataRoot, config);
  }
  return {
    local_asset_id: localAssetId,
    backend_kind: kind,
    selected: payload.select !== false,
    materialization_ref: materializationRef,
    backend_capability_profile_ref: backendCapabilityProfileRef,
    validation,
  };
}

async function importLive2dAdapterManifest(dataRoot: string, payload: Record<string, unknown>): Promise<unknown> {
  const scope = parseScope(payload);
  const localAssetId = parseAvatarAssetId(payload.localAssetId, 'localAssetId');
  const sourcePath = await resolveExistingPath(parseRequiredString(payload.sourcePath, 'sourcePath'), 'sourcePath');
  const assetDir = avatarAssetDir(dataRoot, scope, localAssetId);
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || path.extname(sourcePath).toLowerCase() !== '.json') {
    throw new Error('Live2D adapter manifest import requires a JSON file.');
  }
  await fs.mkdir(assetDir, { recursive: true });
  const manifestRef = `live2d_adapter_${randomHex(12)}`;
  const targetPath = path.join(assetDir, `${manifestRef}.json`);
  await fs.copyFile(sourcePath, targetPath);
  const bytes = await fs.readFile(targetPath);
  const config = await getConfig(dataRoot, scope);
  if (config.modules.avatar_asset.local_avatar_asset_ref !== localAssetId || config.modules.avatar_asset.backend_kind !== 'live2d') {
    throw new Error('Live2D adapter manifest import requires the selected Live2D Avatar asset.');
  }
  config.modules.avatar_asset = {
    ...config.modules.avatar_asset,
    live2d_adapter_manifest_source: 'external_sidecar_manifest',
    live2d_adapter_manifest_ref: manifestRef,
    updated_at: nowIso(),
    provenance: {
      source: 'import_validation',
      evidence_ref: manifestRef,
    },
  };
  await writeConfig(dataRoot, config);
  return {
    manifest_ref: manifestRef,
    local_asset_id: localAssetId,
    selected: true,
    sha256: sha256(bytes),
    bytes: bytes.length,
    imported_at: nowIso(),
  };
}

async function importBackground(dataRoot: string, payload: Record<string, unknown>): Promise<unknown> {
  const scope = parseScope(payload);
  const sourcePath = await resolveExistingPath(parseRequiredString(payload.sourcePath, 'sourcePath'), 'sourcePath');
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) {
    throw new Error('Background import requires an image file.');
  }
  const extension = path.extname(sourcePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(extension)) {
    throw new Error('Background import admits PNG, JPEG, WebP, or AVIF image files.');
  }
  const backgroundAssetId = `bg_${randomHex(12)}`;
  const dir = backgroundDir(dataRoot, scope, backgroundAssetId);
  await fs.mkdir(dir, { recursive: true });
  const targetPath = path.join(dir, `background${extension}`);
  await fs.copyFile(sourcePath, targetPath);
  const validation = await validateBackgroundAsset(dataRoot, scope, backgroundAssetId);
  if (payload.select !== false) {
    const config = await getConfig(dataRoot, scope);
    config.modules.appearance = {
      ...config.modules.appearance,
      background_asset_id: backgroundAssetId,
    };
    await writeConfig(dataRoot, config);
  }
  return {
    background_asset_id: backgroundAssetId,
    selected: payload.select !== false,
    validation,
  };
}

async function removeBackground(dataRoot: string, payload: Record<string, unknown>): Promise<unknown> {
  const scope = parseScope(payload);
  const backgroundAssetId = parseBackgroundAssetId(payload.backgroundAssetId, 'backgroundAssetId');
  const sourceDir = backgroundDir(dataRoot, scope, backgroundAssetId);
  const operationId = `op_${randomHex(12)}`;
  const quarantineDir = path.join(agentCenterDir(dataRoot, scope), 'quarantine', 'background', `${backgroundAssetId}-${operationId}`);
  let quarantined = false;
  if (await pathExists(sourceDir)) {
    await fs.mkdir(path.dirname(quarantineDir), { recursive: true });
    await fs.rename(sourceDir, quarantineDir);
    quarantined = true;
  }
  const config = await getConfig(dataRoot, scope);
  if (config.modules.appearance.background_asset_id === backgroundAssetId) {
    config.modules.appearance = {
      ...config.modules.appearance,
      background_asset_id: null,
    };
    await writeConfig(dataRoot, config);
  }
  return {
    resource_kind: 'background',
    resource_id: backgroundAssetId,
    quarantined,
    operation_id: operationId,
    status: 'completed',
  };
}

async function getBackgroundAsset(
  dataRoot: string,
  scope: LocalConfigScope,
  backgroundAssetId: string,
  resolveLocalAssetUrl: ZhiyuLocalAssetUrlResolver,
): Promise<unknown> {
  const validation = await validateBackgroundAsset(dataRoot, scope, backgroundAssetId);
  const filePath = await findBackgroundFile(backgroundDir(dataRoot, scope, backgroundAssetId));
  if (!filePath) {
    throw new Error(`Background asset is missing: ${backgroundAssetId}`);
  }
  return {
    background_asset_id: backgroundAssetId,
    file_url: await resolveLocalAssetUrl(filePath),
    validation,
  };
}

async function validateAvatarAsset(dataRoot: string, scope: LocalConfigScope, localAssetId: string): Promise<AvatarValidationResult> {
  const kind = localAssetId.startsWith('live2d_') ? 'live2d' : localAssetId.startsWith('vrm_') ? 'vrm' : null;
  const dir = avatarAssetDir(dataRoot, scope, localAssetId);
  const errors: ValidationIssue[] = [];
  if (!kind) {
    errors.push(issue('unsupported_kind', 'Avatar asset id does not match a supported kind.', 'localAssetId'));
  } else if (!(await pathExists(dir))) {
    errors.push(issue('asset_missing', 'Imported Avatar asset directory is missing.', 'localAssetId'));
  } else if (kind === 'live2d') {
    const modelEntries = await findLive2dModelEntries(path.join(dir, 'package'));
    if (modelEntries.length === 0) {
      errors.push(issue('missing_entry', 'Live2D package is missing a .model3.json entry.', 'package'));
    } else if (modelEntries.length > 1) {
      errors.push(issue('invalid_manifest', 'Live2D package contains multiple .model3.json entries.', 'package'));
    }
  } else if (kind === 'vrm' && !(await pathExists(path.join(dir, 'package.vrm')))) {
    errors.push(issue('missing_entry', 'VRM package file is missing.', 'package.vrm'));
  }
  return {
    schema_version: 1,
    local_asset_id: localAssetId,
    checked_at: nowIso(),
    status: errors.length === 0 ? 'valid' : errors[0]?.code as AvatarImportState,
    errors,
    warnings: [],
  };
}

async function validateBackgroundAsset(dataRoot: string, scope: LocalConfigScope, backgroundAssetId: string): Promise<BackgroundValidationResult> {
  const dir = backgroundDir(dataRoot, scope, backgroundAssetId);
  const errors: ValidationIssue[] = [];
  if (!(await pathExists(dir))) {
    errors.push(issue('asset_missing', 'Background asset directory is missing.', 'backgroundAssetId'));
  } else if (!(await findBackgroundFile(dir))) {
    errors.push(issue('missing_image', 'Background asset image is missing.', 'background'));
  }
  return {
    schema_version: 1,
    background_asset_id: backgroundAssetId,
    checked_at: nowIso(),
    status: errors.length === 0 ? 'valid' : errors[0]?.code as BackgroundImportState,
    errors,
    warnings: [],
  };
}

async function getConfig(dataRoot: string, scope: LocalConfigScope): Promise<AgentCenterLocalConfig> {
  const configPath = agentConfigPath(dataRoot, scope);
  const raw = await fs.readFile(configPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (!raw) {
    const config = createDefaultConfig(scope);
    await writeConfig(dataRoot, config);
    return config;
  }
  const parsed = parseJson(raw, 'Agent Center local config');
  const config = parseConfig(parsed);
  assertSameScope(config, scope);
  return config;
}

async function writeConfig(dataRoot: string, config: AgentCenterLocalConfig): Promise<void> {
  const scope: LocalConfigScope = {
    accountId: config.account_id,
    ownerUserId: config.owner_user_id,
    runtimeSourceRef: config.runtime_source_ref,
    localAgentRef: config.local_agent_ref,
  };
  const configPath = agentConfigPath(dataRoot, scope);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await writeJson(configPath, config);
}

function agentConfigPath(dataRoot: string, scope: LocalConfigScope): string {
  return path.join(agentCenterDir(dataRoot, scope), 'config.json');
}

function agentCenterDir(dataRoot: string, scope: LocalConfigScope): string {
  return path.join(dataRoot, 'zhiyu-agent-center', safeSegment(scope.accountId), safeSegment(scope.localAgentRef));
}

function avatarAssetDir(dataRoot: string, scope: LocalConfigScope, localAssetId: string): string {
  return path.join(agentCenterDir(dataRoot, scope), 'avatar-assets', localAssetId);
}

function backgroundDir(dataRoot: string, scope: LocalConfigScope, backgroundAssetId: string): string {
  return path.join(agentCenterDir(dataRoot, scope), 'backgrounds', backgroundAssetId);
}

function safeSegment(value: string): string {
  return sha256(Buffer.from(value)).slice(0, 16);
}

async function assertLive2dSource(sourcePath: string): Promise<void> {
  const modelEntries = await findLive2dModelEntries(sourcePath);
  if (modelEntries.length !== 1) {
    throw new Error('Live2D source folder must contain exactly one .model3.json entry.');
  }
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function findBackgroundFile(dir: string): Promise<string | null> {
  const entries = await fs.readdir(dir).catch(() => []);
  return entries
    .map((entry) => path.join(dir, entry))
    .find((entry) => ['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(path.extname(entry).toLowerCase())) ?? null;
}

async function resolveExistingPath(value: string, field: string): Promise<string> {
  const resolved = path.resolve(value);
  if (!(await pathExists(resolved))) {
    throw new Error(`${field} does not exist.`);
  }
  return resolved;
}

async function pathExists(value: string): Promise<boolean> {
  return fs.access(value).then(() => true, () => false);
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function issue(code: AvatarImportState | BackgroundImportState, message: string, issuePath: string): ValidationIssue {
  return {
    code,
    message,
    path: issuePath,
    severity: 'error',
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${(error as Error).message}`);
  }
}

function randomHex(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}
