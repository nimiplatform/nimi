import path from 'node:path';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import type { NimiElectronCommandHandler } from '@nimiplatform/kit/shell/electron/main';

const VIEWER_PRESET_FILE_NAME = 'viewer-preset.json';
const DEFAULT_WORLD_TOUR_MANIFEST_REL = 'latest/fixture-manifest.json';
const WORLD_TOUR_LAUNCH_TOKEN_PREFIX = 'world-tour-viewer-launch';

type JsonRecord = Record<string, unknown>;

export type TesterElectronWorldTourStorageRoots = {
  readonly cacheRoot: string;
  readonly tempRoot: string;
};

export type TesterElectronCommandHost = {
  readonly registerReadableFile?: (filePath: string) => Promise<void> | void;
  /**
   * Resolves the Runtime-attested cache/temp roots that back the app-owned
   * world-tour fixture cache and launch-token temp handles. Renderer payloads
   * never carry storage roots; the host resolves them from the standard data
   * root binding.
   */
  readonly resolveWorldTourStorageRoots: () => Promise<TesterElectronWorldTourStorageRoots>;
  readonly openWorldTourWindow: (input: {
    readonly route: string;
    readonly title: string;
    readonly width: number;
    readonly height: number;
    readonly minWidth: number;
    readonly minHeight: number;
  }) => Promise<{ readonly windowLabel: string }> | { readonly windowLabel: string };
};

type ResolveWorldTourFixturePayload = {
  readonly manifestPath?: string;
};

type ClaimWorldTourViewerLaunchPayload = {
  readonly manifestPath: string;
  readonly launchToken: string;
};

type SaveWorldTourViewerPresetPayload = {
  readonly manifestPath: string;
  readonly presetJson: string;
};

type OpenWorldTourWindowPayload = {
  readonly manifestPath: string;
};

type ResolvedWorldTourFixture = {
  readonly manifestPath: string;
  readonly worldMarbleUrl?: string;
  readonly colliderMeshUrl?: string;
  readonly viewerPresetPath?: string;
};

export function createTesterElectronCommandHandlers(
  host: TesterElectronCommandHost,
): Readonly<Record<string, NimiElectronCommandHandler>> {
  return {
    resolve_world_tour_fixture: ({ command, payload }) => resolveWorldTourFixture(host, readCommandPayload<ResolveWorldTourFixturePayload>(payload, command)),
    claim_world_tour_viewer_launch: ({ command, payload }) => claimWorldTourViewerLaunch(host, readCommandPayload<ClaimWorldTourViewerLaunchPayload>(payload, command)),
    save_world_tour_viewer_preset: ({ command, payload }) => saveWorldTourViewerPreset(host, readCommandPayload<SaveWorldTourViewerPresetPayload>(payload, command)),
    open_world_tour_window: ({ command, payload }) => openWorldTourWindow(host, readCommandPayload<OpenWorldTourWindowPayload>(payload, command)),
  };
}

async function resolveWorldTourFixture(
  host: TesterElectronCommandHost,
  payload: ResolveWorldTourFixturePayload,
): Promise<ResolvedWorldTourFixture> {
  const { cacheRoot } = await host.resolveWorldTourStorageRoots();
  const manifest = fixtureManifestPath(payload.manifestPath);
  return resolveFixtureFromManifest(host, cacheRoot, manifest);
}

async function claimWorldTourViewerLaunch(
  host: TesterElectronCommandHost,
  payload: ClaimWorldTourViewerLaunchPayload,
): Promise<ResolvedWorldTourFixture> {
  const { cacheRoot, tempRoot } = await host.resolveWorldTourStorageRoots();
  const raw = await readFile(await launchTokenPath(tempRoot), 'utf8')
    .catch((error: unknown) => {
      throw new Error(`read world-tour launch token failed: ${errorMessage(error)}`);
    });
  const tokenPayload = parseJsonObject(raw, 'world-tour launch token JSON invalid');
  const expectedManifest = normalizeText(tokenPayload.manifestPath);
  const expectedToken = normalizeText(tokenPayload.launchToken);
  const canonical = await resolveManifestPath(cacheRoot, payload.manifestPath);
  if (expectedManifest !== canonical || expectedToken !== normalizeRequiredString(payload.launchToken, 'launchToken')) {
    throw new Error('world-tour launch token rejected');
  }
  return resolveFixtureFromManifest(host, cacheRoot, payload.manifestPath);
}

async function saveWorldTourViewerPreset(
  host: TesterElectronCommandHost,
  payload: SaveWorldTourViewerPresetPayload,
): Promise<{ readonly manifestPath: string; readonly presetPath: string }> {
  const { cacheRoot } = await host.resolveWorldTourStorageRoots();
  const manifest = await resolveManifestPath(cacheRoot, payload.manifestPath);
  const parsed = JSON.parse(payload.presetJson) as unknown;
  const presetPath = path.join(path.dirname(manifest), VIEWER_PRESET_FILE_NAME);
  await writeJsonValue(presetPath, parsed, payload.presetJson);
  return {
    manifestPath: manifest,
    presetPath,
  };
}

async function openWorldTourWindow(
  host: TesterElectronCommandHost,
  payload: OpenWorldTourWindowPayload,
): Promise<{ readonly windowLabel: string; readonly manifestPath: string }> {
  const { cacheRoot, tempRoot } = await host.resolveWorldTourStorageRoots();
  const fixture = await resolveFixtureFromManifest(host, cacheRoot, payload.manifestPath);
  const launchToken = await writeLaunchToken(tempRoot, fixture.manifestPath);
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

async function writeJsonValue(filePath: string, value: unknown, fallbackRaw: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(value, null, 2) ?? fallbackRaw;
  await writeFile(filePath, body)
    .catch((error: unknown) => {
      throw new Error(`write tester storage failed (${filePath}): ${errorMessage(error)}`);
    });
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
