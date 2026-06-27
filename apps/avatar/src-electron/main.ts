import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { app, BrowserWindow, ipcMain, protocol, screen, shell, type IpcMainInvokeEvent } from 'electron';
import {
  isAllowedElectronRendererUrl,
  registerNimiElectronRuntimeBridge,
  type NimiElectronRuntimeTrustedCallerMode,
} from '@nimiplatform/kit/shell/electron/main';

const APP_ID = 'nimi.avatar';
const FILE_PROTOCOL = 'nimi-avatar-file';
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
const readableFiles = new Set<string>();
let boundRuntimeIdentity: Readonly<Record<string, string | null>> | undefined;

protocol.registerSchemesAsPrivileged([{
  scheme: FILE_PROTOCOL,
  privileges: {
    standard: true,
    secure: true,
    corsEnabled: true,
    supportFetchAPI: true,
    stream: true,
  },
}]);

app.setName('Nimi Avatar');

void app.whenReady().then(async () => {
  registerReadableFileProtocol();
  const standardDataRoot = resolveStandardDataRoot();
  await mkdir(standardDataRoot, { recursive: true });
  registerAvatarElectronProductCommands(standardDataRoot);
  registerNimiElectronRuntimeBridge({
    appId: APP_ID,
    runtimeEndpoint,
    allowedOrigins: allowedRendererOrigins(),
    allowedRendererUrls: allowedRendererUrls(),
    ipcMain,
    standardShellHost: {
      dataRoot: standardDataRoot,
      localAssetRoots: resolveStandardLocalAssetRoots(standardDataRoot),
      resolveLocalAssetUrl: resolveAvatarLocalAssetUrl,
      openExternalUrl: (url) => shell.openExternal(url),
      localAgentIdentity: {
        ownerUserId: normalizeText(process.env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID) || 'avatar-local-owner',
        runtimeSourceRef: normalizeText(process.env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF) || APP_ID,
      },
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
      case 'nimi_avatar_start_window_drag':
        return { started: false, reasonCode: 'electron-programmatic-window-drag-not-supported' };
      case 'nimi_avatar_begin_manual_drag_window':
        return beginAvatarElectronManualDragWindow(event);
      case 'nimi_avatar_move_manual_drag_window':
        return moveAvatarElectronManualDragWindow(event, payload);
      case 'nimi_avatar_set_window_size':
        return setAvatarElectronWindowSize(event, payload);
      case 'nimi_avatar_set_ignore_cursor_events':
        return setAvatarElectronIgnoreCursorEvents(event, payload);
      case 'nimi_avatar_get_cursor_client_position':
        return getAvatarElectronCursorClientPosition(event);
      case 'nimi_avatar_constrain_window_to_visible_area':
        return constrainAvatarElectronWindowToVisibleArea(event, payload);
      case 'nimi_avatar_set_always_on_top':
        return setAvatarElectronAlwaysOnTop(event, payload);
      case 'nimi_avatar_hide_window':
        return hideAvatarElectronWindow(event);
      case 'nimi_avatar_close_window':
        return closeAvatarElectronWindow(event);
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
    avatarInstanceId: null,
    launchSource: 'electron',
  };
}

function resolveAvatarElectronLocalAgentIdentity(): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} {
  const ownerUserId = normalizeText(process.env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_OWNER_USER_ID) || 'avatar-local-owner';
  const runtimeSourceRef = normalizeText(process.env.NIMI_AVATAR_ELECTRON_LOCAL_AGENT_RUNTIME_SOURCE_REF) || APP_ID;
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef: `local-agent:${ownerUserId}:${runtimeSourceRef}`,
  };
}

function bindAvatarElectronRuntimeIdentity(payload: Readonly<Record<string, unknown>>): Record<string, boolean> {
  const commandPayload = asRecord(payload.payload ?? payload, 'Avatar Runtime identity bind payload must be an object');
  const ownerUserId = normalizeRequiredString(commandPayload.ownerUserId, 'ownerUserId');
  const runtimeSourceRef = normalizeRequiredString(commandPayload.runtimeSourceRef, 'runtimeSourceRef');
  const expectedLocalAgentRef = `local-agent:${ownerUserId}:${runtimeSourceRef}`;
  const localAgentRef = normalizeRequiredString(commandPayload.localAgentRef, 'localAgentRef');
  if (localAgentRef !== expectedLocalAgentRef) {
    throw new Error('Avatar Runtime identity localAgentRef must match ownerUserId and runtimeSourceRef');
  }
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

function beginAvatarElectronManualDragWindow(event: IpcMainInvokeEvent): Record<string, number> {
  const window = senderWindow(event);
  const [x, y] = window.getPosition();
  return {
    x: normalizeNumber(x, 'window.x'),
    y: normalizeNumber(y, 'window.y'),
  };
}

function moveAvatarElectronManualDragWindow(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): Record<string, true> {
  const window = senderWindow(event);
  const origin = asRecord(payload.origin, 'Avatar manual drag origin must be an object');
  const x = Math.round(normalizeNumber(origin.x, 'origin.x') + normalizeNumber(payload.totalDeltaX, 'totalDeltaX'));
  const y = Math.round(normalizeNumber(origin.y, 'origin.y') + normalizeNumber(payload.totalDeltaY, 'totalDeltaY'));
  window.setPosition(x, y);
  return { moved: true };
}

function setAvatarElectronWindowSize(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): Record<string, true> {
  senderWindow(event).setSize(
    Math.round(normalizeNumber(payload.width, 'width')),
    Math.round(normalizeNumber(payload.height, 'height')),
  );
  return { resized: true };
}

function setAvatarElectronIgnoreCursorEvents(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): Record<string, boolean> {
  const ignore = Boolean(payload.ignore);
  senderWindow(event).setIgnoreMouseEvents(ignore, { forward: true });
  return { ignore };
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

function constrainAvatarElectronWindowToVisibleArea(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): Record<string, true> {
  const window = senderWindow(event);
  const bounds = window.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const minVisibleRatio = Math.min(1, Math.max(0.05, normalizeOptionalNumber(payload.minVisibleRatio) ?? 0.2));
  const minVisibleWidth = Math.round(bounds.width * minVisibleRatio);
  const minVisibleHeight = Math.round(bounds.height * minVisibleRatio);
  const area = display.workArea;
  const nextX = Math.min(Math.max(bounds.x, area.x - bounds.width + minVisibleWidth), area.x + area.width - minVisibleWidth);
  const nextY = Math.min(Math.max(bounds.y, area.y - bounds.height + minVisibleHeight), area.y + area.height - minVisibleHeight);
  window.setBounds({ ...bounds, x: nextX, y: nextY });
  return { constrained: true };
}

function setAvatarElectronAlwaysOnTop(
  event: IpcMainInvokeEvent,
  payload: Readonly<Record<string, unknown>>,
): Record<string, boolean> {
  const alwaysOnTop = Boolean(payload.alwaysOnTop);
  senderWindow(event).setAlwaysOnTop(alwaysOnTop);
  return { alwaysOnTop };
}

function hideAvatarElectronWindow(event: IpcMainInvokeEvent): Record<string, true> {
  senderWindow(event).hide();
  return { hidden: true };
}

function closeAvatarElectronWindow(event: IpcMainInvokeEvent): Record<string, true> {
  senderWindow(event).close();
  return { closed: true };
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

async function resolveAvatarLocalAssetUrl(filePath: string): Promise<string> {
  await registerReadableFile(filePath);
  return encodeReadableFileUrl(filePath);
}

async function registerReadableFile(filePath: string): Promise<void> {
  const canonical = await realpath(filePath).catch(() => path.resolve(filePath));
  readableFiles.add(canonical);
}

function encodeReadableFileUrl(filePath: string): string {
  return `${FILE_PROTOCOL}://local/${encodeURIComponent(path.resolve(filePath))}`;
}

function registerReadableFileProtocol(): void {
  protocol.handle(FILE_PROTOCOL, async (request) => {
    try {
      const filePath = decodeReadableFileUrl(request.url);
      const canonical = await realpath(filePath);
      if (!readableFiles.has(canonical)) {
        return new Response('file is not registered for Avatar preview', { status: 403 });
      }
      return new Response(await readFile(canonical), {
        headers: {
          'content-type': contentTypeForPath(canonical),
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error || 'file read failed'), {
        status: 404,
        headers: {
          'access-control-allow-origin': '*',
        },
      });
    }
  });
}

function decodeReadableFileUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== `${FILE_PROTOCOL}:`) {
    throw new Error(`unsupported Avatar file protocol: ${url.protocol}`);
  }
  const encoded = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
  return decodeURIComponent(encoded);
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
