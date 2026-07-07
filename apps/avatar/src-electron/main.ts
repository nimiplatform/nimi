import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendFile, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { app, BrowserWindow, ipcMain, protocol, screen, shell, type IpcMainInvokeEvent } from 'electron';
import {
  assertOpaqueElectronLocalAgentRef,
  createElectronShellFileProtocolHost,
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronRuntimeTrustedCallerMode,
  type NimiElectronShellFileProtocolHost,
  type NimiElectronShellUiCommandInput,
  type NimiElectronStandardDataRootBinding,
} from '@nimiplatform/kit/shell/electron/main';
import { createAvatarElectronTrustedRuntimeMetadataProvider } from './runtime-auth.js';

const APP_ID = 'nimi.avatar';
const AVATAR_PRODUCT_INVOKE_CHANNEL = 'nimi:avatar:invoke';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appRoot = path.resolve(currentDir, '..');
const preloadPath = path.join(currentDir, 'preload.cjs');
const rendererDistIndex = path.join(appRoot, 'dist', 'index.html');
const rendererDistUrl = pathToFileURL(rendererDistIndex).toString();
const rendererUrl = normalizeText(process.env.NIMI_AVATAR_ELECTRON_RENDERER_URL);
const runtimeEndpoint = normalizeText(process.env.NIMI_RUNTIME_GRPC_ADDR)
  || normalizeText(process.env.NIMI_AVATAR_ELECTRON_RUNTIME_ENDPOINT)
  || '127.0.0.1:46371';
let boundRuntimeIdentity: Readonly<Record<string, string | null>> | undefined;

const localAssetProtocolHost = createLocalAssetProtocolHost();
localAssetProtocolHost.registerPrivilegedSchemes();

app.setName('Nimi Avatar');

void app.whenReady().then(async () => {
  localAssetProtocolHost.registerProtocolHandler();
  const standardDataRoot = resolveStandardDataRoot();
  const localAgentIdentity = resolveOptionalAvatarElectronLocalAgentIdentity();
  await mkdir(standardDataRoot, { recursive: true });
  registerAvatarElectronProductCommands(standardDataRoot);
  registerNimiElectronRuntimeBridge({
    appId: APP_ID,
    runtimeEndpoint,
    allowedOrigins: allowedRendererOrigins(),
    allowedRendererUrls: allowedRendererUrls(),
    ipcMain,
    trustedRuntimeMetadataProvider: createAvatarElectronTrustedRuntimeMetadataProvider({
      appId: APP_ID,
      runtimeEndpoint,
    }),
    standardShellHost: {
      standardDataRootBinding: resolveStandardDataRootBinding(),
      localAssetRoots: resolveStandardLocalAssetRoots(standardDataRoot),
      localAssetProtocolHost,
      openExternalUrl: (url) => shell.openExternal(url),
      // Kit standard floating-window host hooks. These operate on the
      // invoking BrowserWindow and back the renderer's kit standard
      // floating-window bridge (drag / size / ignore-cursor / constrain /
      // always-on-top / hide / close). Manual drag reads getPosition at start
      // and setPosition(origin+delta) per move; the window-control primitive
      // is now kit-owned, avatar keeps only the product semantics.
      floatingWindow: {
        // The kit hook types `input.event` as its structural
        // `NimiElectronIpcMainInvokeEvent` subset; at runtime it is the real
        // Electron `IpcMainInvokeEvent`, so `floatingWindowSenderEvent`
        // narrows it back for `senderWindow`.
        setBounds: (payload, input) =>
          setAvatarElectronFloatingWindowBounds(floatingWindowSenderEvent(input), payload),
        setIgnoreCursorEvents: (payload, input) =>
          setAvatarElectronFloatingWindowIgnoreCursorEvents(floatingWindowSenderEvent(input), payload),
        setAlwaysOnTop: (payload, input) =>
          setAvatarElectronFloatingWindowAlwaysOnTop(floatingWindowSenderEvent(input), payload),
        hide: (_payload, input) => hideAvatarElectronFloatingWindow(floatingWindowSenderEvent(input)),
        close: (_payload, input) => closeAvatarElectronFloatingWindow(floatingWindowSenderEvent(input)),
        beginManualDrag: (_payload, input) =>
          beginAvatarElectronFloatingWindowManualDrag(floatingWindowSenderEvent(input)),
        moveManualDrag: (payload, input) =>
          moveAvatarElectronFloatingWindowManualDrag(floatingWindowSenderEvent(input), payload),
        constrainToVisibleArea: (payload, input) =>
          constrainAvatarElectronFloatingWindow(floatingWindowSenderEvent(input), payload),
      },
      ...(localAgentIdentity ? { localAgentIdentity } : {}),
      runtimeTrustedCaller: {
        mode: resolveRuntimeTrustedCallerMode(),
      },
    },
  });

  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

function registerAvatarElectronProductCommands(dataRoot: string): void {
  ipcMain.handle(AVATAR_PRODUCT_INVOKE_CHANNEL, async (event, message) => {
    assertAllowedAvatarRenderer(event);
    const envelope = asRecord(message, 'Avatar Electron product bridge message must be an object');
    const command = normalizeRequiredString(envelope.command, 'command');
    const payload = asRecord(envelope.payload ?? {}, `Avatar Electron product command ${command} payload must be an object`);
    switch (command) {
      case 'nimi_avatar_get_launch_context':
        return resolveAvatarElectronLaunchContext();
      case 'nimi_avatar_bind_runtime_identity':
        return bindAvatarElectronRuntimeIdentity(payload);
      case 'nimi_avatar_record_evidence':
        return recordAvatarElectronEvidence(dataRoot, payload);
      case 'nimi_avatar_write_evidence_artifact':
        return writeAvatarElectronEvidenceArtifact(dataRoot, payload);
      case 'nimi_avatar_resolve_local_avatar_asset':
        return resolveAvatarElectronLocalAvatarAsset(payload);
      // Window control (drag / size / ignore-cursor / constrain /
      // always-on-top / hide / close) is migrated to the kit standard
      // floating-window commands, routed through the standard shell runtime
      // bridge to the `standardShellHost.floatingWindow` hooks below. Only
      // cursor hit-testing stays on this avatar product channel because it is
      // tightly coupled to the alpha-mask click-through decision.
      case 'nimi_avatar_get_cursor_client_position':
        return getAvatarElectronCursorClientPosition(event);
      default:
        throw new Error(`Unsupported Avatar Electron product command: ${command}`);
    }
  });
}

function assertAllowedAvatarRenderer(event: IpcMainInvokeEvent): void {
  const url = normalizeText(event.senderFrame?.url);
  if (!isAvatarRendererUrl(url)) {
    throw new Error(`Avatar Electron renderer URL is not allowed: ${url || '<missing>'}`);
  }
}

function resolveAvatarElectronLaunchContext(): Record<string, string | null> {
  const identity = resolveAvatarElectronLocalAgentIdentity();
  return {
    agentId: identity.localAgentRef,
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
    avatarInstanceId: resolveAvatarElectronAvatarInstanceId(),
    launchSource: normalizeText(process.env.NIMI_AVATAR_ELECTRON_LAUNCH_SOURCE) || 'electron',
  };
}

function resolveAvatarElectronAvatarInstanceId(): string | null {
  return normalizeText(process.env.NIMI_AVATAR_ELECTRON_AVATAR_INSTANCE_ID)
    || normalizeText(process.env.NIMI_AVATAR_ELECTRON_LAUNCH_AVATAR_INSTANCE_ID)
    || null;
}

function resolveOptionalAvatarElectronLocalAgentIdentity(): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} | undefined {
  if (!normalizeText(process.env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF)) {
    return undefined;
  }
  return resolveAvatarElectronLocalAgentIdentity();
}

function resolveAvatarElectronLocalAgentIdentity(): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} {
  const ownerUserId = normalizeRequiredString(
    process.env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID,
    'NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID',
  );
  const runtimeSourceRef = normalizeRequiredString(
    process.env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF,
    'NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF',
  );
  const localAgentRef = normalizeRequiredString(
    process.env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF,
    'NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF',
  );
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error('NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF must start with local-agent:');
  }
  assertOpaqueElectronLocalAgentRef({
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    command: 'NIMI_AVATAR_ELECTRON_LOCAL_AGENT_REF',
  });
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}

function bindAvatarElectronRuntimeIdentity(payload: Readonly<Record<string, unknown>>): Record<string, boolean> {
  const commandPayload = asRecord(payload.payload ?? payload, 'Avatar Runtime identity bind payload must be an object');
  const ownerUserId = normalizeRequiredString(commandPayload.ownerUserId, 'ownerUserId');
  const runtimeSourceRef = normalizeRequiredString(commandPayload.runtimeSourceRef, 'runtimeSourceRef');
  const localAgentRef = normalizeRequiredString(commandPayload.localAgentRef, 'localAgentRef');
  if (!localAgentRef.startsWith('local-agent:')) {
    throw new Error('Avatar Runtime identity localAgentRef must start with local-agent:');
  }
  assertOpaqueElectronLocalAgentRef({
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    command: 'nimi_avatar_bind_runtime_identity',
  });
  boundRuntimeIdentity = {
    avatarInstanceId: normalizeRequiredString(commandPayload.avatarInstanceId, 'avatarInstanceId'),
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    launchSource: normalizeText(commandPayload.launchSource) || null,
  };
  return { bound: true };
}

async function recordAvatarElectronEvidence(
  dataRoot: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const commandPayload = asRecord(payload.payload ?? payload, 'Avatar evidence payload must be an object');
  const kind = normalizeRequiredString(commandPayload.kind, 'kind');
  const evidenceDir = path.join(dataRoot, 'evidence');
  await mkdir(evidenceDir, { recursive: true });
  const artifactPath = path.join(evidenceDir, 'avatar-electron-evidence.jsonl');
  const record = {
    ...commandPayload,
    kind,
    recordedAt: normalizeText(commandPayload.recordedAt) || new Date().toISOString(),
    electron: true,
    boundRuntimeIdentity: boundRuntimeIdentity ?? null,
  };
  const line = `${JSON.stringify(record)}\n`;
  await appendFile(artifactPath, line, 'utf8');
  return {
    artifactPath,
    artifactMimeType: 'application/x-ndjson',
    artifactByteLength: Buffer.byteLength(line),
  };
}

async function writeAvatarElectronEvidenceArtifact(
  dataRoot: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const commandPayload = asRecord(payload.payload ?? payload, 'Avatar evidence artifact payload must be an object');
  const artifactId = normalizeSafeArtifactId(commandPayload.artifactId);
  const dataUrl = normalizeRequiredString(commandPayload.dataUrl, 'dataUrl');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error('Avatar evidence artifact requires a base64 data URL');
  }
  const artifactMimeType = normalizeRequiredString(match[1], 'artifactMimeType');
  const encodedBytes = normalizeRequiredString(match[2], 'artifactBytes');
  const bytes = Buffer.from(encodedBytes, 'base64');
  const artifactDir = path.join(dataRoot, 'evidence', 'artifacts');
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, artifactId);
  await writeFile(artifactPath, bytes);
  return {
    artifactPath,
    artifactMimeType,
    artifactByteLength: bytes.byteLength,
  };
}

async function resolveAvatarElectronLocalAvatarAsset(
  payload: Readonly<Record<string, unknown>>,
): Promise<Record<string, string | null>> {
  const commandPayload = asRecord(payload.payload ?? payload, 'Avatar local asset resolver payload must be an object');
  const scope = {
    accountId: normalizeRequiredString(commandPayload.accountId, 'accountId'),
    ownerUserId: normalizeRequiredString(commandPayload.ownerUserId, 'ownerUserId'),
    runtimeSourceRef: normalizeRequiredString(commandPayload.runtimeSourceRef, 'runtimeSourceRef'),
    localAgentRef: normalizeRequiredString(commandPayload.localAgentRef, 'localAgentRef'),
  };
  if (!scope.localAgentRef.startsWith('local-agent:')) {
    throw new Error('Avatar local asset resolver localAgentRef must start with local-agent:');
  }
  const bound = boundRuntimeIdentity;
  if (!bound) {
    throw new Error('Avatar local asset resolver requires bound Runtime identity.');
  }
  if (
    bound.ownerUserId !== scope.ownerUserId
    || bound.runtimeSourceRef !== scope.runtimeSourceRef
    || bound.localAgentRef !== scope.localAgentRef
  ) {
    throw new Error('Avatar local asset resolver scope does not match bound Runtime identity.');
  }
  const agentCenterDataRoot = resolveAgentCenterDataRoot();
  const config = await readAgentCenterLocalConfig(agentCenterDataRoot, scope);
  const modules = asRecord(config.modules, 'Avatar local asset resolver config missing modules');
  const avatarAsset = asRecord(modules.avatar_asset, 'Avatar local asset resolver config missing avatar_asset module');
  const localAssetId = normalizeRequiredString(avatarAsset.local_avatar_asset_ref, 'modules.avatar_asset.local_avatar_asset_ref');
  const backendKind = normalizeRequiredString(avatarAsset.backend_kind, 'modules.avatar_asset.backend_kind');
  const assetDir = await resolveAgentCenterAssetDir(agentCenterDataRoot, scope, localAssetId);
  if (backendKind === 'vrm') {
    const vrmPath = path.join(assetDir, 'package.vrm');
    await assertFile(vrmPath, 'selected VRM Avatar package is missing');
    return {
      kind: 'vrm',
      runtime_dir: assetDir,
      model_id: localAssetId,
      vrm_file_path: vrmPath,
      nimi_dir: null,
      motion_presets_dir: null,
    };
  }
  if (backendKind === 'live2d') {
    const packageDir = path.join(assetDir, 'package');
    const model3JsonPath = await findSingleLive2dModel3Json(packageDir);
    return {
      kind: 'live2d',
      runtime_dir: packageDir,
      model_id: localAssetId,
      model3_json_path: model3JsonPath,
      nimi_dir: null,
      adapter_manifest_path: normalizeAgentCenterAdapterManifestPath(assetDir, avatarAsset.live2d_adapter_manifest_ref),
      live2d_calibration_ref: normalizeText(avatarAsset.live2d_calibration_ref) || null,
    };
  }
  throw new Error(`Avatar local asset resolver backend kind is not admitted: ${backendKind}`);
}

function resolveAgentCenterDataRoot(): string {
  const fromEnv = normalizeText(process.env.NIMI_AVATAR_ELECTRON_AGENT_CENTER_DATA_ROOT);
  if (!fromEnv) {
    throw new Error('Avatar local asset resolver requires NIMI_AVATAR_ELECTRON_AGENT_CENTER_DATA_ROOT');
  }
  return path.resolve(fromEnv);
}

async function readAgentCenterLocalConfig(
  dataRoot: string,
  scope: {
    readonly accountId: string;
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
): Promise<Readonly<Record<string, unknown>>> {
  const configPath = path.join(agentCenterDir(dataRoot, scope), 'config.json');
  const parsed = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
  const config = asRecord(parsed, 'Avatar local asset resolver Agent Center config must be an object');
  if (
    config.schema_version !== 1
    || config.config_kind !== 'agent_center_local_config'
    || normalizeText(config.account_id) !== scope.accountId
    || normalizeText(config.owner_user_id) !== scope.ownerUserId
    || normalizeText(config.runtime_source_ref) !== scope.runtimeSourceRef
    || normalizeText(config.local_agent_ref) !== scope.localAgentRef
  ) {
    throw new Error('Avatar local asset resolver Agent Center config scope is invalid.');
  }
  return config;
}

async function resolveAgentCenterAssetDir(
  dataRoot: string,
  scope: {
    readonly accountId: string;
    readonly localAgentRef: string;
  },
  localAssetId: string,
): Promise<string> {
  if (!/^(?:live2d|vrm)_[a-f0-9]{12}$/u.test(localAssetId)) {
    throw new Error(`Avatar local asset resolver asset id is invalid: ${localAssetId}`);
  }
  const root = await realpath(path.resolve(dataRoot));
  const candidate = path.join(agentCenterDir(root, scope), 'avatar-assets', localAssetId);
  const canonical = await realpath(candidate);
  if (!isPathInside(canonical, root)) {
    throw new Error('Avatar local asset resolver rejected asset path outside Agent Center data root.');
  }
  return canonical;
}

function agentCenterDir(
  dataRoot: string,
  scope: {
    readonly accountId: string;
    readonly localAgentRef: string;
  },
): string {
  return path.join(dataRoot, 'zhiyu-agent-center', hashedSegment(scope.accountId), hashedSegment(scope.localAgentRef));
}

function hashedSegment(value: string): string {
  return createHash('sha256').update(Buffer.from(value)).digest('hex').slice(0, 16);
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function assertFile(filePath: string, message: string): Promise<void> {
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new Error(message);
  }
}

async function findSingleLive2dModel3Json(root: string): Promise<string> {
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error('selected Live2D Avatar package directory is missing');
  }
  const found: string[] = [];
  await walkLive2dPackage(root, found);
  if (found.length !== 1) {
    throw new Error(`selected Live2D Avatar package must contain exactly one .model3.json entry, found ${found.length}`);
  }
  return found[0]!;
}

async function walkLive2dPackage(dir: string, found: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkLive2dPackage(entryPath, found);
    } else if (entry.isFile() && entry.name.endsWith('.model3.json')) {
      found.push(entryPath);
    }
  }
}

function normalizeAgentCenterAdapterManifestPath(assetDir: string, manifestRef: unknown): string | null {
  const ref = normalizeText(manifestRef);
  if (!ref) {
    return null;
  }
  if (!/^live2d_adapter_[a-f0-9]{12}$/u.test(ref)) {
    throw new Error(`Avatar local asset resolver adapter manifest ref is invalid: ${ref}`);
  }
  return path.join(assetDir, `${ref}.json`);
}

// Kit standard floating-window host hooks (Electron). Each acts on the
// invoking BrowserWindow. Payloads are the kit camelCase wire shapes; return
// shapes match the kit renderer bridge parsers (beginManualDrag →
// {mode,originX,originY}; constrain → {constrained}; others → {}).

function beginAvatarElectronFloatingWindowManualDrag(
  event: IpcMainInvokeEvent,
): Record<string, unknown> {
  const window = senderWindow(event);
  const [x, y] = window.getPosition();
  return {
    mode: 'manual',
    originX: Math.round(normalizeNumber(x, 'window.x')),
    originY: Math.round(normalizeNumber(y, 'window.y')),
  };
}

function moveAvatarElectronFloatingWindowManualDrag(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): void {
  const window = senderWindow(event);
  const x = Math.round(normalizeNumber(payload.originX, 'originX') + normalizeNumber(payload.totalDeltaX, 'totalDeltaX'));
  const y = Math.round(normalizeNumber(payload.originY, 'originY') + normalizeNumber(payload.totalDeltaY, 'totalDeltaY'));
  window.setPosition(x, y);
}

function setAvatarElectronFloatingWindowBounds(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): void {
  const window = senderWindow(event);
  const width = normalizeOptionalNumber(payload.width);
  const height = normalizeOptionalNumber(payload.height);
  const x = normalizeOptionalNumber(payload.x);
  const y = normalizeOptionalNumber(payload.y);
  if (width !== undefined && height !== undefined) {
    window.setSize(Math.round(width), Math.round(height));
  }
  if (x !== undefined && y !== undefined) {
    window.setPosition(Math.round(x), Math.round(y));
  }
}

function setAvatarElectronFloatingWindowIgnoreCursorEvents(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): void {
  const ignore = Boolean(payload.ignore);
  const forward = payload.forward === undefined ? true : Boolean(payload.forward);
  senderWindow(event).setIgnoreMouseEvents(ignore, { forward });
}

function setAvatarElectronFloatingWindowAlwaysOnTop(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): void {
  senderWindow(event).setAlwaysOnTop(Boolean(payload.alwaysOnTop));
}

function hideAvatarElectronFloatingWindow(event: IpcMainInvokeEvent): void {
  senderWindow(event).hide();
}

function closeAvatarElectronFloatingWindow(event: IpcMainInvokeEvent): void {
  senderWindow(event).close();
}

function constrainAvatarElectronFloatingWindow(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): Record<string, boolean> {
  const window = senderWindow(event);
  const bounds = window.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const minVisibleRatio = Math.min(1, Math.max(0.05, normalizeOptionalNumber(payload.minVisibleRatio) ?? 0.2));
  const minVisibleWidth = Math.ceil(bounds.width * minVisibleRatio);
  const minVisibleHeight = Math.ceil(bounds.height * minVisibleRatio);
  const area = display.workArea;
  const nextX = Math.min(Math.max(bounds.x, area.x - bounds.width + minVisibleWidth), area.x + area.width - minVisibleWidth);
  const nextY = Math.min(Math.max(bounds.y, area.y - bounds.height + minVisibleHeight), area.y + area.height - minVisibleHeight);
  const constrained = nextX !== bounds.x || nextY !== bounds.y;
  if (constrained) {
    window.setBounds({ ...bounds, x: nextX, y: nextY });
  }
  return { constrained };
}

function getAvatarElectronCursorClientPosition(event: IpcMainInvokeEvent): Record<string, number> {
  const window = senderWindow(event);
  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds();
  const display = screen.getDisplayMatching(bounds);
  return {
    screenX: cursor.x,
    screenY: cursor.y,
    clientX: cursor.x - bounds.x,
    clientY: cursor.y - bounds.y,
    scaleFactor: display.scaleFactor || 1,
  };
}

function floatingWindowSenderEvent(input: NimiElectronShellUiCommandInput): IpcMainInvokeEvent {
  // The kit floating-window hook exposes the invoking IPC event through its
  // structural `NimiElectronIpcMainInvokeEvent` subset; at runtime it is the
  // real Electron `IpcMainInvokeEvent`, so `senderWindow` can resolve the
  // BrowserWindow from `event.sender`.
  return input.event as unknown as IpcMainInvokeEvent;
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    throw new Error('Avatar Electron product command has no sender window');
  }
  return window;
}

function asRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Readonly<Record<string, unknown>>;
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`Avatar Electron product command requires ${field}`);
  }
  return normalized;
}

function normalizeSafeArtifactId(value: unknown): string {
  const artifactId = normalizeRequiredString(value, 'artifactId');
  if (!/^[A-Za-z0-9._-]+$/u.test(artifactId) || artifactId.includes('..')) {
    throw new Error(`Avatar evidence artifactId is not safe: ${artifactId}`);
  }
  return artifactId;
}

function normalizeNumber(value: unknown, field: string): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Avatar Electron product command requires numeric ${field}`);
  }
  return numberValue;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 720,
    height: 900,
    minWidth: 360,
    minHeight: 520,
    title: 'Nimi Avatar',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  secureAvatarWindow(window);
  await window.loadURL(rendererUrl || rendererDistUrl);
  return window;
}

function secureAvatarWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAvatarRendererUrl(url)) {
      event.preventDefault();
    }
  });
}

function allowedRendererOrigins(): string[] {
  const origins = new Set<string>();
  for (const url of allowedRendererUrls()) {
    origins.add(originForRendererUrl(url));
  }
  for (const origin of normalizeText(process.env.NIMI_AVATAR_ELECTRON_ALLOWED_ORIGINS).split(',')) {
    const normalized = normalizeText(origin);
    if (normalized) {
      origins.add(normalized);
    }
  }
  return [...origins];
}

function allowedRendererUrls(): string[] {
  const urls = new Set<string>([rendererUrl || rendererDistUrl]);
  for (const url of normalizeText(process.env.NIMI_AVATAR_ELECTRON_ALLOWED_RENDERER_URLS).split(',')) {
    const normalized = normalizeText(url);
    if (normalized) {
      urls.add(normalized);
    }
  }
  return [...urls];
}

function originForRendererUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === 'file:' ? 'file://' : parsed.origin;
}

function isAvatarRendererUrl(url: string): boolean {
  return isAllowedElectronRendererUrl(url, allowedRendererUrls());
}

function resolveStandardDataRoot(): string {
  const fromEnv = normalizeText(process.env.NIMI_AVATAR_ELECTRON_STANDARD_DATA_ROOT);
  return path.resolve(fromEnv || path.join(app.getPath('userData'), 'standard-shell-data'));
}

function resolveStandardDataRootBinding(): NimiElectronStandardDataRootBinding {
  const fromEnv = normalizeText(process.env.NIMI_AVATAR_ELECTRON_STANDARD_DATA_ROOT);
  if (fromEnv) {
    return {
      source: 'runtime-launch-projection',
      durableDataRoot: path.resolve(fromEnv),
      projectionRef: 'avatar-electron-acceptance-fixture',
    };
  }
  return { source: 'runtime-get-app-storage' };
}

function resolveStandardLocalAssetRoots(dataRoot: string): string[] {
  const fromEnv = normalizeText(process.env.NIMI_AVATAR_ELECTRON_STANDARD_LOCAL_ASSET_ROOTS);
  if (!fromEnv) {
    return [dataRoot].map((filePath) => path.resolve(filePath));
  }
  return fromEnv
    .split(path.delimiter)
    .map((filePath) => normalizeText(filePath))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath));
}

function resolveRuntimeTrustedCallerMode(): NimiElectronRuntimeTrustedCallerMode {
  const mode = normalizeText(process.env.NIMI_AVATAR_ELECTRON_RUNTIME_TRUSTED_CALLER_MODE) || 'local-first-party-app';
  if (
    mode === 'local-developer-app'
    || mode === 'local-first-party-app'
    || mode === 'desktop-shell'
  ) {
    return mode;
  }
  throw new Error(`unsupported Avatar Electron Runtime trusted caller mode: ${mode}`);
}

function createLocalAssetProtocolHost(): NimiElectronShellFileProtocolHost {
  return createElectronShellFileProtocolHost({
    protocol: {
      registerSchemesAsPrivileged: (schemes) => protocol.registerSchemesAsPrivileged([...schemes]),
      handle: (scheme, handler) => protocol.handle(scheme, (request) => handler(request) as Promise<Response>),
    },
    roots: resolveStandardLocalAssetRoots(resolveStandardDataRoot()),
  });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
