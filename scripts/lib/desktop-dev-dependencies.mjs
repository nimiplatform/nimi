import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseEnv, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnCommand } from './command-runner.mjs';
import { composePnpmSpawn } from './pnpm-command.mjs';
import { runSourceRuntimeDevelopment } from '../dev-runtime.mjs';
import { readDevelopmentRealm, developmentRealmEnvironment } from './development-realm.mjs';

const execute = promisify(execFile);
const acceptsRealmKeys = (value) => Array.isArray(value?.keys) && value.keys.length > 0
  && value.keys.every((key) => key.kty === 'RSA' && key.kid && key.n && key.e);

export function readDesktopDevEnvironment(root, environment = process.env) {
  const envPath = path.join(root, '.env');
  return { ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}), ...environment };
}

// HTTP loopback browser cookies are site-bound. Keep the local login page and
// its API on the same loopback hostname without changing Runtime's API origin.
export function desktopWebRealmOrigin(realm) {
  const api = new URL(realm.apiOrigin);
  const web = new URL(realm.webOrigin);
  const loopback = (host) => host === 'localhost' || host === '127.0.0.1';
  if (realm.name === 'local' && api.protocol === 'http:' && web.protocol === 'http:'
    && loopback(api.hostname) && loopback(web.hostname)) api.hostname = web.hostname;
  return api.origin;
}

async function portOccupied(url) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostname, port: Number(port) });
    const finish = (occupied) => { socket.destroy(); resolve(occupied); };
    socket.setTimeout(1500, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(error.code !== 'ECONNREFUSED'));
  });
}

// A responding unrelated process must never be treated as a ready dependency.
export async function probeDevHttp(url, accepts, { text = false } = {}) {
  let response;
  try {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2500) });
  } catch {
    return { state: await portOccupied(url) ? 'unavailable' : 'missing' };
  }
  if (!response.ok) return { state: 'unavailable', detail: `HTTP ${response.status}` };
  try {
    const value = text ? await response.text() : await response.json();
    return { state: accepts(value) ? 'ready' : 'conflict' };
  } catch {
    return { state: 'conflict' };
  }
}

export function desktopHttpDependencies(root, realm = readDevelopmentRealm(root)) {
  if (realm.name === 'official') return [];
  const realmOrigin = realm.apiOrigin;
  const realtimeOrigin = realm.realtimeOrigin;
  const webOrigin = realm.webOrigin;
  const webRoot = realpathSync(path.join(root, 'apps', 'web'));
  const workspace = createHash('sha256').update(process.platform === 'win32' ? webRoot.toLowerCase() : webRoot).digest('hex');
  return [
    { name: 'Realm API', script: 'dev:api', external: true,
      probe: () => probeDevHttp(`${realmOrigin}/api/auth/jwks`, acceptsRealmKeys) },
    { name: 'Realm Realtime', script: 'dev:realtime', external: true,
      probe: () => probeDevHttp(`${realtimeOrigin}/socket.io/?EIO=4&transport=polling`, (value) => {
        if (!value.startsWith('0')) return false;
        const packet = JSON.parse(value.slice(1));
        return typeof packet.sid === 'string' && Array.isArray(packet.upgrades) && packet.pingInterval > 0;
      }, { text: true }) },
    { name: 'Web', script: 'dev:web',
      probe: async () => {
        const identity = await probeDevHttp(`${webOrigin}/__nimi_web_dev__`, (value) => value?.application === 'nimi-web'
          && value.workspace === workspace && value.mode === 'development');
        return identity.state === 'ready' ? probeDevHttp(`${webOrigin}/api/auth/jwks`, acceptsRealmKeys) : identity;
      } },
  ];
}

export function validateRealmDevDirectory(directory, baseDirectory = process.cwd()) {
  if (!directory) throw new Error('Realm services are missing. Set NIMI_DEV_REALM_DIR in .env to your configured Realm development workspace, or start Realm API (3002) and Realtime (3003) separately.');
  const root = realpathSync(path.resolve(baseDirectory, directory));
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const command of ['dev:infra', 'dev:api', 'dev:realtime']) {
    if (typeof manifest.scripts?.[command] !== 'string') throw new Error(`Realm development workspace must provide pnpm ${command}: ${root}`);
  }
  return root;
}

export async function waitForDevDependency(service, { signal, timeoutMs = 180_000, failure = () => undefined } = {}) {
  const deadline = Date.now() + timeoutMs;
  let result;
  do {
    signal?.throwIfAborted();
    const error = failure();
    if (error) throw error;
    result = await service.probe();
    if (result.state === 'ready') return;
    if (result.state === 'conflict') throw new Error(`${service.name}: another service or workspace occupies the required endpoint. Stop that process explicitly.`);
    await delay(500, undefined, { signal });
  } while (Date.now() < deadline);
  throw new Error(`${service.name} did not become ready within ${timeoutMs / 1000}s (${result?.detail || result?.state}).`);
}

// Process/endpoint observations decide whether to start the source supervisor.
// Desktop still performs the protected native admission and readiness handshake.
export async function probeSourceRuntime(root, realmName) {
  let rows;
  let endpoint;
  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop"',
      '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value.ToLowerInvariant()',
      '$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($sid))',
      '$identity = ([BitConverter]::ToString($hash)).Replace("-", "").ToLowerInvariant()',
      '$pipe = "\\\\.\\pipe\\nimi-runtime-source-local-development-$identity-desktop-v1"',
      '$rows = @(Get-CimInstance Win32_Process -Filter "Name = \'nimi.exe\' OR Name = \'nimi-source-runtime-supervisor.exe\'" | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)',
      '@{ rows = $rows; endpoint = (Test-Path -LiteralPath $pipe) } | ConvertTo-Json -Depth 4 -Compress',
    ].join('\n');
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10_000 });
    ({ rows, endpoint } = JSON.parse(stdout));
  } else if (process.platform === 'darwin') {
    const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 10_000 });
    rows = stdout.split('\n').flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/u);
      return match ? [{ ProcessId: Number(match[1]), ParentProcessId: Number(match[2]), ExecutablePath: match[3], Name: path.basename(match[3]) }] : [];
    });
  } else {
    throw new Error('Desktop source development requires Windows x64 or macOS arm64.');
  }
  const expected = path.join(root, '.nimi', 'local', process.platform === 'win32' ? 'imp6' : 'imp3', 'runtime-local-development', process.platform === 'win32' ? 'nimi.exe' : 'nimi-runtime');
  const normalize = (value) => process.platform === 'win32' ? String(value || '').toLowerCase() : value;
  const runtime = rows.find((row) => normalize(row.ExecutablePath) === normalize(expected)
    && rows.some((owner) => owner.ProcessId === row.ParentProcessId && /^nimi-source-runtime-supervisor(?:\.exe)?$/u.test(owner.Name)));
  if (rows.some((row) => /^(?:nimi(?:\.exe)?|nimi-runtime)$/u.test(row.Name) && row !== runtime)) {
    return { state: 'conflict' };
  }
  if (process.platform === 'darwin' && runtime) {
    const socket = path.join(os.homedir(), 'Library', 'Application Support', 'Nimi', 'RuntimeLocalDevelopment', 'run', 'runtime-desktop.sock');
    try {
      const { stdout } = await execute('/usr/sbin/lsof', ['-nP', '-a', '-p', String(runtime.ProcessId), '-U', '-Fn'], { timeout: 10_000 });
      endpoint = stdout.split('\n').includes(`n${socket}`);
    } catch (error) {
      if (error.code !== 1) throw error;
      endpoint = false;
    }
  }
  if (runtime && realmName) {
    const owner = rows.find((row) => row.ProcessId === runtime.ParentProcessId);
    const commandLine = process.platform === 'win32' ? owner?.CommandLine
      : (await execute('/bin/ps', ['-p', String(runtime.ParentProcessId), '-o', 'args='], { timeout: 10_000 })).stdout;
    if (String(commandLine || '').match(/(?:^|\s)--realm\s+(official|local)(?:\s|$)/u)?.[1] !== realmName) {
      throw new Error('The active source Runtime uses another Realm environment. Stop that source instance before switching.');
    }
  }
  if (runtime) return { state: endpoint ? 'ready' : 'starting' };
  return { state: endpoint ? 'conflict' : 'missing' };
}

export function launchDevService(root, service, env, logRoot) {
  const plan = composePnpmSpawn(['run', service.script], { env });
  const child = spawnCommand(plan.command, plan.args, {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    windowsVerbatimArguments: plan.windowsVerbatimArguments, detached: process.platform !== 'win32',
  });
  const logPath = path.join(logRoot, `${service.script.replaceAll(':', '-')}-${child.pid}.log`);
  let error;
  let exited = false;
  let stopping = false;
  let writes = Promise.resolve();
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk) => { writes = writes.then(() => appendFile(logPath, chunk)).catch((cause) => { error = cause; }); });
  }
  const done = new Promise((resolve) => {
    child.once('error', (cause) => { error = cause; exited = true; resolve(); });
    child.once('exit', (code, signal) => {
      exited = true;
      if (!stopping && (service.script !== 'dev:infra' || code !== 0)) error = new Error(`${service.name} exited (${code ?? signal}). See ${logPath}`);
      resolve();
    });
  });
  return {
    logPath, failure: () => error, done,
    async stop() {
      stopping = true;
      if (!exited && child.pid) {
        if (process.platform === 'win32') {
          await execute('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).catch((cause) => {
            if (!exited) throw cause;
          });
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch (cause) { if (cause.code !== 'ESRCH') throw cause; }
          await Promise.race([done, delay(3000)]);
          try { process.kill(-child.pid, 'SIGKILL'); } catch (cause) { if (cause.code !== 'ESRCH') throw cause; }
        }
      }
      await writes;
    },
  };
}

export async function prepareDesktopDevDependencies(root, { signal, realm = readDevelopmentRealm(root), externalEnvironment = process.env } = {}) {
  const env = readDesktopDevEnvironment(root);
  const logRoot = path.join(root, '.nimi', 'local', 'dev-services');
  mkdirSync(logRoot, { recursive: true });
  const owned = [];
  const runtimeOwner = createSourceRuntimeOwner((runtimeSignal) => runSourceRuntimeDevelopment({
    argv: ['--realm', realm.name], env: { ...env, ...developmentRealmEnvironment(realm) }, repoRoot: root, signal: runtimeSignal,
  }));
  let closeTask;
  const log = (message) => process.stdout.write(`[desktop-deps] ${message}\n`);
  log(`Realm: ${realm.name} (${realm.apiOrigin})`);
  const close = () => {
    closeTask ??= (async () => {
      await runtimeOwner.close();
      const stopped = await Promise.allSettled(owned.reverse().map((child) => child.stop()));
      for (const result of stopped) if (result.status === 'rejected') process.stderr.write(`[desktop-deps] cleanup failed: ${result.reason}\n`);
    })();
    return closeTask;
  };
  try {
    const services = desktopHttpDependencies(root, realm);
    const states = await Promise.all(services.map((service) => service.probe()));
    for (let index = 0; index < services.length; index += 1) {
      if (states[index].state === 'conflict') {
        throw new Error(`${services[index].name}: another service or workspace occupies the required endpoint. Stop that process explicitly.`);
      }
    }
    // Resolve configuration before starting anything, so incomplete setup cannot
    // leave an unexplained half-started Desktop session.
    const needsRealm = services.some((service, index) => service.external && states[index].state === 'missing');
    const realmRoot = realm.name === 'local' && (env.NIMI_DEV_REALM_DIR || needsRealm) ? validateRealmDevDirectory(env.NIMI_DEV_REALM_DIR, root) : undefined;
    if (realmRoot) {
      signal?.throwIfAborted();
      log('Checking Realm data services…');
      const infra = launchDevService(realmRoot, { name: 'Realm data services', script: 'dev:infra' }, externalEnvironment, logRoot);
      owned.push(infra);
      await Promise.race([
        infra.done,
        delay(180_000, undefined, { signal, ref: false }).then(() => { throw new Error(`Realm data-service check timed out. See ${infra.logPath}`); }),
      ]);
      if (infra.failure()) throw infra.failure();
    }
    for (const service of services) {
      signal?.throwIfAborted();
      const state = await service.probe();
      if (state.state === 'ready') { log(`Reusing ${service.name}.`); continue; }
      if (state.state !== 'missing') throw new Error(`${service.name} is listening but not ready (${state.detail || state.state}). Stop or repair the occupying service; it will not be replaced.`);
      log(`Starting ${service.name}…`);
      // The probe can use a numeric loopback address. Browser authentication
      // must keep the configured Realm origin so its session cookies stay same-site.
      const serviceEnv = service.external ? externalEnvironment : { ...env, ...developmentRealmEnvironment(realm), NIMI_REALM_URL: desktopWebRealmOrigin(realm) };
      const child = launchDevService(service.external ? realmRoot : root, service, serviceEnv, logRoot);
      owned.push(child);
      log(`${service.name} log: ${child.logPath}`);
      await waitForDevDependency(service, { signal, failure: child.failure });
    }
    const runtime = { name: 'Source Runtime', probe: () => probeSourceRuntime(root, realm.name) };
    const state = await runtime.probe();
    if (state.state === 'conflict') throw new Error('A Nimi Runtime is already active. Quit it before starting this source Nimi; installed and source Runtime cannot run together.');
    if (state.state === 'missing') {
      log('Starting source Runtime…');
      runtimeOwner.start();
    } else log('Reusing source Runtime.');
    await waitForDevDependency(runtime, { signal, failure: runtimeOwner.failure });
    log('Dependencies are available; starting Desktop for protected Runtime admission.');
    return { close, async restartRuntime() {
      signal?.throwIfAborted();
      log('Home selected its data root; restarting the owned source Runtime before Home relaunch.');
      await runtimeOwner.restart();
      await waitForDevDependency(runtime, { signal, failure: runtimeOwner.failure });
    } };
  } catch (error) {
    await close();
    throw error;
  }
}

// Home's explicit profile-relaunch outcome is the only restart trigger. An
// independently started supervisor is not adopted, and crashes are not retried.
export function createSourceRuntimeOwner(launch) {
  let task, abort, failure;
  let closed = false;
  const start = () => {
    if (closed || task) throw new Error('Source Runtime owner is already active or closed.');
    abort = new AbortController();
    const current = abort;
    task = Promise.resolve().then(() => launch(current.signal))
      .then(() => { if (!current.signal.aborted) failure = new Error('Source Runtime exited.'); })
      .catch(error => { failure = error; });
  };
  return { start, failure: () => failure,
    async close() { closed = true; abort?.abort(); await task; },
    async restart() {
      if (closed || !task) throw new Error('Restart the independently started source Runtime in its owner terminal, then start Home again.');
      abort.abort();
      await task;
      if (closed) throw new Error('Source Runtime owner is closing.');
      if (failure) throw failure;
      task = undefined; failure = undefined;
      start();
    },
  };
}
