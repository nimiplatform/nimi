import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

declare const __NIMI_MACOS_LOCAL_APP_HOST_PATH__: string;
declare const __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__: boolean;
declare const __NIMI_ELECTRON_DEVELOPMENT_BUILD__: boolean;

const MACOS_LOCAL_DEVELOPMENT_BUILD = typeof __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_MACOS_LOCAL_DEVELOPMENT_BUILD__;
const MACOS_LOCAL_DEVELOPMENT_HOST_PATH = typeof __NIMI_MACOS_LOCAL_APP_HOST_PATH__ === 'string'
  ? __NIMI_MACOS_LOCAL_APP_HOST_PATH__
  : '';
const MACOS_PER_USER_RUNTIME_D2 = typeof __NIMI_ELECTRON_DEVELOPMENT_BUILD__ !== 'undefined'
  && __NIMI_ELECTRON_DEVELOPMENT_BUILD__
  && process.env.NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT === '1';
const MACOS_PRODUCTION_LOCAL_APP_HOST_PATH = '/Applications/Nimi.app/Contents/Frameworks/Nimi Local App Host.app/Contents/MacOS/Nimi Local App Host';

export type ElectronLocalDevelopmentPlan = {
  readonly appId: string;
  readonly displayName: string;
  readonly projectRoot: string;
  readonly rendererOrigin: string;
  readonly electronExecutable: string;
  readonly mainEntry: string;
};

export async function resolveElectronLocalDevelopmentPlan(
  rawRoot: string,
  expectedAppId: string,
  requestedShell: string,
): Promise<ElectronLocalDevelopmentPlan> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') fail('local-development-platform-unsupported');
  if (requestedShell !== 'electron') fail('local-development-platform-unsupported');
  const projectRoot = await canonicalDirectory(rawRoot);
  const manifestPath = within(projectRoot, path.join(projectRoot, 'nimi.app.yaml'));
  const manifest = parseYaml(await readFile(manifestPath, 'utf8')) as unknown;
  const document = record(manifest);
  const appId = exactAppId(document.app_id);
  const displayName = text(document.display_name);
  if (expectedAppId !== appId) fail('local-development-project-changed');
  const localDevelopment = record(document.local_development);
  const electron = record(localDevelopment.electron);
  const rendererOrigin = loopbackOrigin(electron.renderer_origin);

  const packagePath = within(projectRoot, path.join(projectRoot, 'package.json'));
  const packageDocument = record(JSON.parse(await readFile(packagePath, 'utf8')) as unknown);
  const scripts = record(packageDocument.scripts);
  if (scripts.dev !== 'nimi-app dev --shell electron'
    || scripts['dev:shell'] !== 'nimi-app dev'
    || scripts['dev:renderer'] !== `vite --host 127.0.0.1 --port ${new URL(rendererOrigin).port} --strictPort`
    || typeof scripts['build:electron'] !== 'string'
    || scripts['build:electron'].trim() !== scripts['build:electron']
    || scripts['build:electron'].length === 0) {
    fail('local-development-project-changed');
  }

  const electronExecutable = process.platform === 'darwin'
    ? await canonicalFile(macOSLocalAppHostPath())
    : await canonicalFile(within(projectRoot, path.join(
      projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe',
    )));
  const mainEntry = within(projectRoot, path.join(projectRoot, 'dist-electron', 'main.js'));
  return { appId, displayName, projectRoot, rendererOrigin, electronExecutable, mainEntry };
}

function macOSLocalAppHostPath(): string {
  if (MACOS_PER_USER_RUNTIME_D2) return process.execPath;
  if (!MACOS_LOCAL_DEVELOPMENT_BUILD) return MACOS_PRODUCTION_LOCAL_APP_HOST_PATH;
  if (!path.isAbsolute(MACOS_LOCAL_DEVELOPMENT_HOST_PATH)
    || path.normalize(MACOS_LOCAL_DEVELOPMENT_HOST_PATH) !== MACOS_LOCAL_DEVELOPMENT_HOST_PATH) {
    fail('local-development-platform-unsupported');
  }
  return MACOS_LOCAL_DEVELOPMENT_HOST_PATH;
}

export async function canonicalElectronMain(plan: ElectronLocalDevelopmentPlan): Promise<string> {
  return canonicalFile(within(plan.projectRoot, plan.mainEntry));
}

function loopbackOrigin(value: unknown): string {
  let url: URL;
  try {
    url = new URL(text(value));
  } catch {
    fail('local-development-dev-server-uncontrolled');
  }
  if (url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !url.port
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash) {
    fail('local-development-dev-server-uncontrolled');
  }
  return url.origin;
}

function exactAppId(value: unknown): string {
  const appId = text(value);
  if (appId.length > 160
    || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u.test(appId)) {
    fail('local-development-project-changed');
  }
  return appId;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > 4096) {
    fail('local-development-project-changed');
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('local-development-project-changed');
  return value as Record<string, unknown>;
}

async function canonicalDirectory(value: string): Promise<string> {
  const candidate = path.resolve(text(value));
  const canonical = await realpath(candidate).catch(() => fail('local-development-project-changed'));
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) fail('local-development-project-changed');
  return canonical;
}

async function canonicalFile(value: string): Promise<string> {
  const canonical = await realpath(value).catch(() => fail('local-development-project-changed'));
  const metadata = await stat(canonical);
  if (!metadata.isFile()) fail('local-development-project-changed');
  return canonical;
}

function within(root: string, candidate: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    if (relative) fail('local-development-project-changed');
  }
  return path.resolve(candidate);
}

function fail(reasonCode: string): never {
  throw new ElectronLocalDevelopmentPlanError(reasonCode);
}

export class ElectronLocalDevelopmentPlanError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string) {
    super(reasonCode);
    this.name = 'ElectronLocalDevelopmentPlanError';
    this.reasonCode = reasonCode;
  }
}
