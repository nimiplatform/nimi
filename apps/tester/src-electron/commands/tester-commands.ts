import path from 'node:path';
import { Buffer } from 'node:buffer';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import type { NimiElectronCommandHandler } from '@nimiplatform/kit/shell/electron/main';

const RUN_HISTORY_FILE = 'tester-run-history.json';
const IMAGE_HISTORY_FILE = 'tester-image-history.json';
const FALLBACK_EXPORT_FILE_NAME = 'nimi-tester-generation.txt';
const DEFAULT_WORLD_TOUR_MANIFEST_REL = 'latest/fixture-manifest.json';
const VIEWER_PRESET_FILE_NAME = 'viewer-preset.json';
const WORLD_TOUR_LAUNCH_TOKEN_PREFIX = 'world-tour-viewer-launch';

type JsonRecord = Record<string, unknown>;

export type TesterElectronCommandHost = {
  readonly downloadsDir: string;
  readonly revealInOs?: (filePath: string) => Promise<void> | void;
  readonly registerReadableFile?: (filePath: string) => Promise<void> | void;
  readonly openWorldTourWindow: (input: {
    readonly route: string;
    readonly title: string;
    readonly width: number;
    readonly height: number;
    readonly minWidth: number;
    readonly minHeight: number;
  }) => Promise<{ readonly windowLabel: string }> | { readonly windowLabel: string };
};

type TesterStorageRootPayload = {
  readonly storageRoot: string;
};

type TesterHistorySavePayload = TesterStorageRootPayload & {
  readonly recordsJson: string;
};

type TesterExportSavePayload = {
  readonly filename: string;
  readonly mimeType?: string;
  readonly dataBase64: string;
};

type TesterArtifactSavePayload = TesterExportSavePayload & TesterStorageRootPayload;

type TesterExportSaveResult = {
  readonly artifactPath: string;
  readonly filename: string;
  readonly byteSize: number;
  readonly mimeType?: string;
};

type ResolveWorldTourFixturePayload = {
  readonly manifestPath?: string;
  readonly cacheRoot: string;
};

type ClaimWorldTourViewerLaunchPayload = {
  readonly manifestPath: string;
  readonly launchToken: string;
  readonly cacheRoot: string;
  readonly tempRoot: string;
};

type SaveWorldTourViewerPresetPayload = {
  readonly manifestPath: string;
  readonly presetJson: string;
  readonly cacheRoot: string;
};

type OpenWorldTourWindowPayload = {
  readonly manifestPath: string;
  readonly cacheRoot: string;
  readonly tempRoot: string;
};

type ResolvedWorldTourFixture = {
  readonly manifestPath: string;
  readonly worldMarbleUrl?: string;
  readonly colliderMeshUrl?: string;
  readonly viewerPresetPath?: string;
};

type WorldTourRenderAcceptance = {
  readonly manifestPath: string;
  readonly renderer: string;
  readonly status: string;
  readonly acceptedAt: string;
  readonly note?: string;
  readonly dataRoot: string;
};

type WorldTourStoragePayload = {
  readonly dataRoot: string;
};

export function createTesterElectronCommandHandlers(
  host: TesterElectronCommandHost,
): Readonly<Record<string, NimiElectronCommandHandler>> {
  return {
    tester_run_history_load: ({ command, payload }) => testerRunHistoryLoad(readCommandPayload<TesterStorageRootPayload>(payload, command)),
    tester_run_history_save: ({ command, payload }) => testerRunHistorySave(readCommandPayload<TesterHistorySavePayload>(payload, command)),
    tester_image_history_load: ({ command, payload }) => testerImageHistoryLoad(readCommandPayload<TesterStorageRootPayload>(payload, command)),
    tester_image_history_save: ({ command, payload }) => testerImageHistorySave(readCommandPayload<TesterHistorySavePayload>(payload, command)),
    tester_export_save: async ({ command, payload }) => {
      const result = await testerExportSave(host, readCommandPayload<TesterExportSavePayload>(payload, command));
      await Promise.resolve(host.revealInOs?.(result.artifactPath));
      return result;
    },
    tester_artifact_save: ({ command, payload }) => testerArtifactSave(host, readCommandPayload<TesterArtifactSavePayload>(payload, command)),
    resolve_world_tour_fixture: ({ command, payload }) => resolveWorldTourFixture(host, readCommandPayload<ResolveWorldTourFixturePayload>(payload, command)),
    claim_world_tour_viewer_launch: ({ command, payload }) => claimWorldTourViewerLaunch(host, readCommandPayload<ClaimWorldTourViewerLaunchPayload>(payload, command)),
    save_world_tour_viewer_preset: ({ command, payload }) => saveWorldTourViewerPreset(readCommandPayload<SaveWorldTourViewerPresetPayload>(payload, command)),
    world_tour_render_acceptance_save: ({ command, payload }) => worldTourRenderAcceptanceSave(readCommandPayload<WorldTourRenderAcceptance>(payload, command)),
    world_tour_render_acceptance_load: ({ command, payload }) => worldTourRenderAcceptanceLoad(readCommandPayload<WorldTourStoragePayload>(payload, command)),
    open_world_tour_window: ({ command, payload }) => openWorldTourWindow(host, readCommandPayload<OpenWorldTourWindowPayload>(payload, command)),
  };
}

async function testerRunHistoryLoad(payload: TesterStorageRootPayload): Promise<string> {
  return readOrDefault(await historyPath(payload.storageRoot, RUN_HISTORY_FILE), '{}');
}

async function testerRunHistorySave(payload: TesterHistorySavePayload): Promise<Record<string, never>> {
  await writeJson(await historyPath(payload.storageRoot, RUN_HISTORY_FILE), payload.recordsJson, false);
  return {};
}

async function testerImageHistoryLoad(payload: TesterStorageRootPayload): Promise<string> {
  return readOrDefault(await historyPath(payload.storageRoot, IMAGE_HISTORY_FILE), '[]');
}

async function testerImageHistorySave(payload: TesterHistorySavePayload): Promise<Record<string, never>> {
  await writeJson(await historyPath(payload.storageRoot, IMAGE_HISTORY_FILE), payload.recordsJson, true);
  return {};
}

async function testerExportSave(
  host: TesterElectronCommandHost,
  payload: TesterExportSavePayload,
): Promise<TesterExportSaveResult> {
  const bytes = decodeBase64(payload.dataBase64, 'TESTER_EXPORT_INVALID_BASE64');
  return saveExportBytes(host.downloadsDir, payload.filename, payload.mimeType, bytes, host);
}

async function testerArtifactSave(
  host: TesterElectronCommandHost,
  payload: TesterArtifactSavePayload,
): Promise<TesterExportSaveResult> {
  const bytes = decodeBase64(payload.dataBase64, 'TESTER_ARTIFACT_INVALID_BASE64');
  const artifactDir = await scopedStorageChild(payload.storageRoot, 'tester data root', 'artifacts');
  return saveExportBytes(artifactDir, payload.filename, payload.mimeType, bytes, host);
}

async function resolveWorldTourFixture(
  host: TesterElectronCommandHost,
  payload: ResolveWorldTourFixturePayload,
): Promise<ResolvedWorldTourFixture> {
  const manifest = fixtureManifestPath(payload.manifestPath);
  return resolveFixtureFromManifest(host, payload.cacheRoot, manifest);
}

async function claimWorldTourViewerLaunch(
  host: TesterElectronCommandHost,
  payload: ClaimWorldTourViewerLaunchPayload,
): Promise<ResolvedWorldTourFixture> {
  const raw = await readFile(await launchTokenPath(payload.tempRoot), 'utf8')
    .catch((error: unknown) => {
      throw new Error(`read world-tour launch token failed: ${errorMessage(error)}`);
    });
  const tokenPayload = parseJsonObject(raw, 'world-tour launch token JSON invalid');
  const expectedManifest = normalizeText(tokenPayload.manifestPath);
  const expectedToken = normalizeText(tokenPayload.launchToken);
  const canonical = await resolveManifestPath(payload.cacheRoot, payload.manifestPath);
  if (expectedManifest !== canonical || expectedToken !== normalizeRequiredString(payload.launchToken, 'launchToken')) {
    throw new Error('world-tour launch token rejected');
  }
  return resolveFixtureFromManifest(host, payload.cacheRoot, payload.manifestPath);
}

async function saveWorldTourViewerPreset(
  payload: SaveWorldTourViewerPresetPayload,
): Promise<{ readonly manifestPath: string; readonly presetPath: string }> {
  const manifest = await resolveManifestPath(payload.cacheRoot, payload.manifestPath);
  const parsed = JSON.parse(payload.presetJson) as unknown;
  const presetPath = path.join(path.dirname(manifest), VIEWER_PRESET_FILE_NAME);
  await writeJsonValue(presetPath, parsed, payload.presetJson);
  return {
    manifestPath: manifest,
    presetPath,
  };
}

async function worldTourRenderAcceptanceSave(
  payload: WorldTourRenderAcceptance,
): Promise<Record<string, never>> {
  if (!normalizeText(payload.manifestPath)) {
    throw new Error('world-tour render acceptance manifestPath is required');
  }
  if (payload.renderer !== 'spark-2.0') {
    throw new Error('world-tour render acceptance renderer must be spark-2.0');
  }
  if (payload.status !== 'passed' && payload.status !== 'failed') {
    throw new Error('world-tour render acceptance status must be passed or failed');
  }
  const acceptance = {
    manifestPath: payload.manifestPath,
    renderer: payload.renderer,
    status: payload.status,
    acceptedAt: payload.acceptedAt,
    note: payload.note,
  };
  await writeJsonValue(await acceptancePath(payload.dataRoot), acceptance, JSON.stringify(acceptance));
  return {};
}

async function worldTourRenderAcceptanceLoad(
  payload: WorldTourStoragePayload,
): Promise<Omit<WorldTourRenderAcceptance, 'dataRoot'> | null> {
  const filePath = await acceptancePath(payload.dataRoot);
  if (!await exists(filePath)) {
    return null;
  }
  return JSON.parse(await readFile(filePath, 'utf8')) as Omit<WorldTourRenderAcceptance, 'dataRoot'>;
}

async function openWorldTourWindow(
  host: TesterElectronCommandHost,
  payload: OpenWorldTourWindowPayload,
): Promise<{ readonly windowLabel: string; readonly manifestPath: string }> {
  const fixture = await resolveFixtureFromManifest(host, payload.cacheRoot, payload.manifestPath);
  const launchToken = await writeLaunchToken(payload.tempRoot, fixture.manifestPath);
  const route = routeForViewer(fixture.manifestPath, launchToken);
  const window = await Promise.resolve(host.openWorldTourWindow({
    route,
    title: 'World Tour',
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
  }));
  return {
    windowLabel: window.windowLabel,
    manifestPath: fixture.manifestPath,
  };
}

async function historyPath(storageRoot: string, fileName: string): Promise<string> {
  return scopedStorageChild(storageRoot, 'tester data root', fileName);
}

async function readOrDefault(filePath: string, defaultJson: string): Promise<string> {
  if (!await exists(filePath)) {
    return defaultJson;
  }
  return readFile(filePath, 'utf8')
    .catch((error: unknown) => {
      throw new Error(`read tester storage failed (${filePath}): ${errorMessage(error)}`);
    });
}

async function writeJson(filePath: string, rawJson: string, expectedArray: boolean): Promise<void> {
  const parsed = JSON.parse(rawJson) as unknown;
  if (expectedArray && !Array.isArray(parsed)) {
    throw new Error('tester storage payload must be an array');
  }
  if (!expectedArray && (!isRecord(parsed) || Array.isArray(parsed))) {
    throw new Error('tester storage payload must be an object');
  }
  await writeJsonValue(filePath, parsed, rawJson);
}

async function writeJsonValue(filePath: string, value: unknown, fallbackRaw: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(value, null, 2) ?? fallbackRaw;
  await writeFile(filePath, body)
    .catch((error: unknown) => {
      throw new Error(`write tester storage failed (${filePath}): ${errorMessage(error)}`);
    });
}

async function saveExportBytes(
  outputDir: string,
  filename: string,
  mimeType: string | undefined,
  bytes: Buffer,
  host: TesterElectronCommandHost,
): Promise<TesterExportSaveResult> {
  if (bytes.byteLength === 0) {
    throw new Error('TESTER_EXPORT_EMPTY_PAYLOAD: export payload is empty');
  }
  await mkdir(outputDir, { recursive: true })
    .catch((error: unknown) => {
      throw new Error(`TESTER_EXPORT_OUTPUT_DIR_UNWRITABLE: ${errorMessage(error)}`);
    });
  const safeFilename = sanitizeExportFilename(filename);
  const artifactPath = await uniqueExportOutputPath(outputDir, safeFilename);
  await writeFile(artifactPath, bytes)
    .catch((error: unknown) => {
      throw new Error(`TESTER_EXPORT_ARTIFACT_UNWRITABLE: unable to write ${artifactPath}: ${errorMessage(error)}`);
    });
  await Promise.resolve(host.registerReadableFile?.(artifactPath));
  return {
    artifactPath,
    filename: path.basename(artifactPath),
    byteSize: bytes.byteLength,
    mimeType,
  };
}

function sanitizeExportFilename(filename: string): string {
  const normalized = normalizeText(filename)
    .split('')
    .map((char) => /[a-zA-Z0-9._-]/u.test(char) ? char : '-')
    .join('');
  const collapsed = normalized.split('-').filter(Boolean).join('-');
  const trimmed = collapsed.replace(/^\.+|\.+$/gu, '').replace(/^-+|-+$/gu, '');
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return FALLBACK_EXPORT_FILE_NAME;
  }
  return trimmed.slice(0, 180);
}

async function uniqueExportOutputPath(outputDir: string, filename: string): Promise<string> {
  const candidate = path.join(outputDir, filename);
  if (!await exists(candidate)) {
    return candidate;
  }
  const parsed = path.parse(filename);
  const stem = parsed.name || 'nimi-tester-generation';
  for (let index = 1; index < 10_000; index += 1) {
    const next = path.join(outputDir, `${stem}-${index}${parsed.ext}`);
    if (!await exists(next)) {
      return next;
    }
  }
  return path.join(outputDir, `${stem}-${Date.now()}${parsed.ext}`);
}

async function canonicalStorageRoot(root: string, label: string): Promise<string> {
  const resolved = path.resolve(normalizeRequiredString(root, label));
  await mkdir(resolved, { recursive: true });
  return realpath(resolved)
    .catch((error: unknown) => {
      throw new Error(`resolve ${label} failed: ${errorMessage(error)}`);
    });
}

async function scopedStorageChild(root: string, label: string, child: string): Promise<string> {
  const canonicalRoot = await canonicalStorageRoot(root, label);
  if (path.isAbsolute(child)) {
    throw new Error(`${label} child path must be relative`);
  }
  const target = path.resolve(canonicalRoot, child);
  if (!isSameOrChildPath(canonicalRoot, target)) {
    throw new Error(`${label} child escapes storage root: ${target}`);
  }
  return target;
}

async function worldTourCacheRoot(cacheRoot: string): Promise<string> {
  const root = path.join(await canonicalStorageRoot(cacheRoot, 'tester cache root'), 'world-tour');
  await mkdir(root, { recursive: true });
  return realpath(root)
    .catch((error: unknown) => {
      throw new Error(`resolve world-tour cache root failed: ${errorMessage(error)}`);
    });
}

async function resolveManifestPath(cacheRoot: string, input: string): Promise<string> {
  const root = await worldTourCacheRoot(cacheRoot);
  const candidate = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input);
  const canonical = await realpath(candidate)
    .catch((error: unknown) => {
      throw new Error(`resolve world-tour manifest failed (${candidate}): ${errorMessage(error)}`);
    });
  if (!isSameOrChildPath(root, canonical)) {
    throw new Error(`world-tour manifest escapes tester cache: ${canonical}`);
  }
  return canonical;
}

async function resolveFixtureFromManifest(
  host: TesterElectronCommandHost,
  cacheRoot: string,
  manifestPath: string,
): Promise<ResolvedWorldTourFixture> {
  const canonical = await resolveManifestPath(cacheRoot, manifestPath);
  const manifest = parseJsonObject(
    await readFile(canonical, 'utf8')
      .catch((error: unknown) => {
        throw new Error(`read world-tour manifest failed (${canonical}): ${errorMessage(error)}`);
      }),
    'world-tour manifest JSON invalid',
  );
  const parent = path.dirname(canonical);
  const worldMarblePath = normalizeText(manifest.worldMarblePath) || normalizeText(manifest.world_marble_path);
  const colliderMeshPath = normalizeText(manifest.colliderMeshPath) || normalizeText(manifest.collider_mesh_path);
  const worldMarbleUrl = worldMarblePath ? path.join(parent, worldMarblePath) : undefined;
  const colliderMeshUrl = colliderMeshPath ? path.join(parent, colliderMeshPath) : undefined;
  const presetPath = path.join(parent, VIEWER_PRESET_FILE_NAME);
  for (const filePath of [canonical, worldMarbleUrl, colliderMeshUrl, await exists(presetPath) ? presetPath : undefined]) {
    if (filePath) {
      await Promise.resolve(host.registerReadableFile?.(filePath));
    }
  }
  return {
    manifestPath: canonical,
    worldMarbleUrl,
    colliderMeshUrl,
    viewerPresetPath: await exists(presetPath) ? presetPath : undefined,
  };
}

function fixtureManifestPath(input: unknown): string {
  return normalizeText(input) || DEFAULT_WORLD_TOUR_MANIFEST_REL;
}

async function launchTokenPath(tempRoot: string): Promise<string> {
  return scopedStorageChild(tempRoot, 'tester temp root', `world-tour/${WORLD_TOUR_LAUNCH_TOKEN_PREFIX}.json`);
}

async function writeLaunchToken(tempRoot: string, manifestPath: string): Promise<string> {
  const launchToken = String(process.hrtime.bigint());
  const filePath = await launchTokenPath(tempRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonValue(filePath, {
    manifestPath,
    launchToken,
  }, '{}');
  return launchToken;
}

function routeForViewer(manifestPath: string, launchToken: string): string {
  const params = new URLSearchParams();
  params.set('manifestPath', manifestPath);
  params.set('launchToken', launchToken);
  return `/#/world-tour-viewer?${params.toString()}`;
}

async function acceptancePath(dataRoot: string): Promise<string> {
  return scopedStorageChild(dataRoot, 'tester data root', 'world-tour-render-acceptance.json');
}

function readCommandPayload<T extends JsonRecord>(
  args: Readonly<Record<string, unknown>>,
  command: string,
): T {
  const payload = args.payload;
  if (!isRecord(payload)) {
    throw new Error(`${command} payload must be an object`);
  }
  return payload as T;
}

function parseJsonObject(raw: string, label: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
    throw new Error('expected object');
  } catch (error) {
    throw new Error(`${label}: ${errorMessage(error)}`);
  }
}

function decodeBase64(value: unknown, reasonCode: string): Buffer {
  const normalized = normalizeRequiredString(value, 'dataBase64').replace(/\s+/gu, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) {
    throw new Error(`${reasonCode}: invalid base64`);
  }
  return Buffer.from(normalized, 'base64');
}

async function exists(filePath: string): Promise<boolean> {
  return access(filePath).then(() => true, () => false);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isSameOrChildPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}
