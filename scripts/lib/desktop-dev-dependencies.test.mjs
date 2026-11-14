import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  createSourceRuntimeOwner,
  launchDevService,
  prepareSourceRuntimeDependency,
  probeDevHttp,
  probeSourceRuntime,
  readDesktopDevEnvironment,
  reportDesktopStartupFailure,
  validateRealmDevDirectory,
  waitForDevDependency,
} from './desktop-dev-dependencies.mjs';

function sourceObservation({ endpoint = true, extra = [], runtime = {}, supervisor = {}, omitRuntime = false, omitSupervisor = false } = {}) {
  const root = 'C:\\work space\\nimi';
  const executable = path.win32.join(root, '.nimi', 'local', 'imp6', 'runtime-local-development', 'nimi.exe');
  const supervisorPath = 'C:\\temp\\source-owner\\nimi-source-runtime-supervisor.exe';
  const rows = [
    ...(!omitSupervisor ? [{ ProcessId: 10, ParentProcessId: 9, Name: 'nimi-source-runtime-supervisor.exe', ExecutablePath: supervisorPath,
      CommandLine: `"${supervisorPath}" --repo-root "${root}" --realm local --realm-url http://127.0.0.1:3002`, ...supervisor }] : []),
    ...(!omitRuntime ? [{ ProcessId: 20, ParentProcessId: 10, Name: 'nimi.exe', ExecutablePath: executable, CommandLine: `"${executable}" serve`, ...runtime }] : []),
    ...extra.map(row => ({ ExecutablePath: executable, Name: 'nimi.exe', ...row })),
  ];
  return { root, executable, rows, endpoint };
}
function probeObservation(observation) {
  return probeSourceRuntime(observation.root, 'local', {
    platform: 'win32', executeCommand: async () => ({ stdout: JSON.stringify(observation) }),
  });
}
test('source Runtime preflight identifies the supervised serve and its exact managed image child', async () => {
  const observation = sourceObservation();
  assert.equal((await probeObservation(observation)).state, 'ready');
  observation.rows.push({ ProcessId: 30, ParentProcessId: 20, Name: 'nimi.exe', ExecutablePath: observation.executable,
    CommandLine: `"${observation.executable}" managed-image-backend serve --port 49208` });
  assert.equal((await probeObservation(observation)).state, 'ready');
});
test('source Runtime preflight waits for supervisor/process/endpoint observations to converge', async () => {
  assert.equal((await probeObservation(sourceObservation({ omitRuntime: true, endpoint: false }))).state, 'starting');
  assert.equal((await probeObservation(sourceObservation({ omitRuntime: true }))).state, 'starting');
  assert.equal((await probeObservation(sourceObservation({ omitRuntime: true, omitSupervisor: true }))).state, 'unavailable');
  assert.equal((await probeObservation(sourceObservation({ supervisor: { CommandLine: null } }))).state, 'unavailable');
  assert.equal((await probeObservation(sourceObservation({ runtime: { ExecutablePath: null } }))).state, 'unavailable');
  assert.equal((await probeObservation(sourceObservation({ endpoint: false }))).state, 'starting');
  assert.equal((await probeObservation(sourceObservation({ omitRuntime: true, omitSupervisor: true, endpoint: false }))).state, 'missing');
});
test('source Runtime preflight never exempts another serve or a foreign executable as a managed child', async () => {
  const observation = sourceObservation();
  for (const extra of [
    { ProcessId: 30, ParentProcessId: 20, CommandLine: `"${observation.executable}" serve` },
    { ProcessId: 30, ParentProcessId: 20, ExecutablePath: 'C:\\other\\nimi.exe', CommandLine: 'C:\\other\\nimi.exe managed-image-backend serve' },
    { ProcessId: 30, ParentProcessId: 10, CommandLine: `"${observation.executable}" managed-image-backend serve` },
  ]) assert.equal((await probeObservation(sourceObservation({ extra: [extra] }))).state, 'conflict');
  assert.equal((await probeObservation(sourceObservation({ extra: [{ ProcessId: 30, ParentProcessId: 20, CommandLine: null }] }))).state, 'unavailable');
});
test('source Runtime preflight keeps empty/truncated CIM output unavailable without exposing process arguments', async () => {
  for (const stdout of ['', '  \r\n', '{"rows":', '{"rows":[{"CommandLine":"private-test-marker', '{"rows":null,"endpoint":true}', '{"rows":[]}']) {
    const result = await probeSourceRuntime('C:\\work space\\nimi', 'local', { platform: 'win32', executeCommand: async () => ({ stdout }) });
    assert.equal(result.state, 'unavailable');
    assert.ok(!JSON.stringify(result).includes('private-test-marker'));
  }
  const result = await probeSourceRuntime('C:\\work space\\nimi', 'local', { platform: 'win32', executeCommand: async () => { throw new Error('CIM query failed'); } });
  assert.equal(result.state, 'unavailable');
});
test('source Runtime preflight waits for normal asynchronous stdout and rejects incomplete output from an exiting producer', async () => {
  const execute = promisify(execFile);
  const complete = '{"rows":[],"endpoint":false}';
  const normal = await probeSourceRuntime('C:\\work space\\nimi', 'local', {
    platform: 'win32', executeCommand: async (_command, _args, options) => execute(process.execPath, ['-e', `process.stdout.write('{"rows":');setTimeout(()=>process.stdout.write('[],"endpoint":false}'),30);`], options),
  });
  assert.equal(normal.state, 'missing');
  const child = `setTimeout(() => process.stdout.write('[],"endpoint":false}'), 80);`;
  const parent = `const {spawn}=require('node:child_process');process.stdout.write('{"rows":',()=>spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:['ignore','inherit','inherit'],windowsHide:true}).unref());`;
  let observed;
  const result = await probeSourceRuntime('C:\\work space\\nimi', 'local', {
    platform: 'win32', executeCommand: async (_command, _args, options) => {
      const output = await execute(process.execPath, ['-e', parent], options);
      observed = output.stdout;
      return output;
    },
  });
  assert.equal(result.state, observed === complete ? 'missing' : 'unavailable');
});
test('source Runtime preflight distinguishes incomplete Realm metadata from an explicit different Realm', async () => {
  await assert.rejects(probeObservation(sourceObservation({ supervisor: { CommandLine: '"C:\\temp\\source-owner\\nimi-source-runtime-supervisor.exe" --realm official' } })), /another Realm/);
  assert.equal((await probeObservation(sourceObservation({ supervisor: { CommandLine: '"C:\\temp\\source-owner\\nimi-source-runtime-supervisor.exe" --realm="local"' } }))).state, 'ready');
  assert.equal((await probeObservation(sourceObservation({ supervisor: { CommandLine: '"C:\\temp\\source-owner\\nimi-source-runtime-supervisor.exe" --realm local --realm official' } }))).state, 'unavailable');
  assert.equal((await probeObservation(sourceObservation({ omitSupervisor: true }))).state, 'unavailable');
});
test('source Runtime preflight verifies the macOS worker ancestry and the exact Runtime-owned socket', async () => {
  const root = '/workspace/nimi', homeDirectory = '/Users/test';
  const executable = `${root}/.nimi/local/imp3/runtime-local-development/nimi-runtime`;
  const supervisor = '/tmp/source owner/nimi-source-runtime-supervisor';
  const commands = { 10: `${supervisor} --repo-root ${root} --realm local`, 20: `${executable} serve`, 30: `${executable} managed-image-backend serve` };
  const result = await probeSourceRuntime(root, 'local', { platform: 'darwin', homeDirectory, executeCommand: async (command, args) => {
    if (command === '/usr/sbin/lsof') return { stdout: `p20\nn${homeDirectory}/Library/Application Support/Nimi/RuntimeLocalDevelopment/run/runtime-desktop.sock\n` };
    if (args[0] === '-axo') return { stdout: `10 9 ${supervisor}\n20 10 ${executable}\n30 20 ${executable}\n` };
    return { stdout: commands[args[2]] };
  } });
  assert.equal(result.state, 'ready');
});
test('macOS startup waits for the executable path and distinguishes installed Runtime from Home', async () => {
  const root = '/workspace/nimi';
  const homeDirectory = '/Users/test';
  const source = `${root}/.nimi/local/imp3/runtime-local-development/nimi-runtime`;
  const supervisor = '/tmp/nimi-source-runtime-supervisor';
  const installed = '/Applications/Nimi.app/Contents/Library/LaunchServices/nimi-runtime';
  const installedHome = '/Applications/Nimi.app/Contents/MacOS/Nimi';
  const probe = (runtimePath, extraExecutable) => probeSourceRuntime(root, 'local', {
    platform: 'darwin', homeDirectory,
    executeCommand: async (command, args) => {
      if (command === '/usr/sbin/lsof') return { stdout: `p20\nn${homeDirectory}/Library/Application Support/Nimi/RuntimeLocalDevelopment/run/runtime-desktop.sock\n` };
      assert.equal(command, '/bin/ps');
      if (args[0] === '-axo') {
        const extraRow = extraExecutable ? `30 1 ${extraExecutable}\n` : '';
        return { stdout: `10 9 ${supervisor}\n20 10 ${runtimePath}\n${extraRow}` };
      }
      if (args[2] === '10') return { stdout: `${supervisor} --realm local` };
      if (args[2] === '20') return { stdout: `${runtimePath} serve` };
      assert.equal(args[2], '30');
      return { stdout: extraExecutable };
    },
  });
  assert.equal((await probe('nimi-runtime')).state, 'unavailable');
  assert.equal((await probe(source, installed)).state, 'conflict');
  assert.equal((await probe(source, installedHome)).state, 'ready');
});
test('startup failure is visible before blocked cleanup and remains the original failure after cleanup rejects', async () => {
  const messages = [], original = new Error('empty process JSON');
  let finish;
  const cleanup = new Promise(resolve => { finish = resolve; });
  const pending = reportDesktopStartupFailure(original, 'Source Runtime startup', () => {
    assert.match(messages[0], /Source Runtime startup: empty process JSON/);
    return cleanup;
  }, message => messages.push(message));
  const rejected = assert.rejects(pending, error => error === original);
  assert.match(messages[1], /Waiting for owned dependency cleanup/);
  finish(); await rejected;
  const second = [];
  await assert.rejects(reportDesktopStartupFailure(original, 'preflight', async () => { throw new Error('owner cleanup failed'); }, message => second.push(message)), error => error === original);
  assert.match(second[2], /Cleanup failed: owner cleanup failed/);
});
test('uncertain initial observation starts an owner only after confirmed absence, once, without adopting an exiting owner', async () => {
  let starts = 0;
  const owner = { start: () => { starts++; }, failure: () => undefined };
  const states = ['unavailable', 'missing', 'missing', 'ready'];
  await prepareSourceRuntimeDependency({ name: 'Source Runtime', probe: async () => ({ state: states.shift() }) }, owner, { timeoutMs: 5000 });
  assert.equal(starts, 1);
  starts = 0;
  const existing = ['starting', 'missing'];
  await assert.rejects(prepareSourceRuntimeDependency({ name: 'Source Runtime', probe: async () => ({ state: existing.shift() }) }, owner, { timeoutMs: 5000 }), /owner terminal/);
  assert.equal(starts, 0);
  await assert.rejects(prepareSourceRuntimeDependency({ name: 'Source Runtime', probe: async () => ({ state: 'conflict' }) }, owner), /another service/);
  assert.equal(starts, 0);
});

test('explicit Home relaunch waits for its own Runtime shutdown and never adopts another owner', async () => {
  let finish;
  let starts = 0;
  const owner = createSourceRuntimeOwner(signal => {
    starts++;
    return new Promise(resolve => { finish = resolve; signal.addEventListener('abort', () => {}); });
  });
  await assert.rejects(owner.restart(), /owner terminal/);
  owner.start();
  await Promise.resolve();
  const restart = owner.restart();
  assert.equal(starts, 1, 'replacement cannot overlap the old process');
  finish();
  await restart;
  await Promise.resolve();
  assert.equal(starts, 2);
  assert.equal(owner.failure(), undefined);
  const closing = owner.close();
  finish();
  await closing;
  await assert.rejects(owner.restart(), /owner terminal/);
});

test('HTTP readiness rejects unrelated services, errors and malformed responses', async (t) => {
  let body = '{"application":"expected"}';
  let status = 200;
  const server = createServer((_request, response) => { response.writeHead(status); response.end(body); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const accepts = (value) => value?.application === 'expected';
  assert.equal((await probeDevHttp(url, accepts)).state, 'ready');
  body = '{"application":"unrelated"}';
  assert.equal((await probeDevHttp(url, accepts)).state, 'conflict');
  body = '<html>another server</html>';
  assert.equal((await probeDevHttp(url, accepts)).state, 'conflict');
  status = 503;
  assert.deepEqual(await probeDevHttp(url, accepts), { state: 'unavailable', detail: 'HTTP 503' });
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal((await probeDevHttp(url, accepts)).state, 'missing');
});

test('startup waiting surfaces process exit, occupied endpoints, timeout and cancellation', async () => {
  await assert.rejects(waitForDevDependency({ name: 'API', probe: async () => ({ state: 'missing' }) }, {
    failure: () => new Error('compiler exited'),
  }), /compiler exited/u);
  await assert.rejects(waitForDevDependency({ name: 'Web', probe: async () => ({ state: 'conflict' }) }), /another service/u);
  await assert.rejects(waitForDevDependency({ name: 'API', probe: async () => ({ state: 'unavailable' }) }, { timeoutMs: 1 }), /did not become ready/u);
  const abort = new AbortController();
  const waiting = waitForDevDependency({ name: 'Runtime', probe: async () => ({ state: 'starting' }) }, { signal: abort.signal });
  abort.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
});

test('Realm startup requires an explicit workspace with the guarded commands', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-deps-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => validateRealmDevDirectory(''), /NIMI_DEV_REALM_DIR/u);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'dev:api': 'node api.mjs' } }));
  assert.throws(() => validateRealmDevDirectory(root), /dev:infra/u);
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    'dev:infra': 'node infra.mjs', 'dev:api': 'node api.mjs', 'dev:realtime': 'node realtime.mjs',
  } }));
  assert.equal(validateRealmDevDirectory(root), realpathSync(root));
});

test('local startup configuration is read without overwriting explicit shell settings', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'services'));
  writeFileSync(path.join(root, '.env'), 'NIMI_DEV_REALM_DIR="./services"\nNIMI_REALM_URL=http://127.0.0.1:3002\n');
  assert.equal(readDesktopDevEnvironment(root, {}).NIMI_DEV_REALM_DIR, './services');
  assert.equal(readDesktopDevEnvironment(root, { NIMI_DEV_REALM_DIR: '/explicit' }).NIMI_DEV_REALM_DIR, '/explicit');
});

test('owned development process trees are stopped while an independent service survives', { timeout: 20_000 }, async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'desktop-owned-service-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node service.cjs' } }));
  writeFileSync(path.join(root, 'service.cjs'), `const fs=require('node:fs'); const http=require('node:http'); const server=http.createServer((_,res)=>res.end(JSON.stringify({application:'owned-test-service'}))); server.listen(0,'127.0.0.1',()=>fs.writeFileSync('port',String(server.address().port)));`);
  const independent = createServer((_request, response) => response.end('alive'));
  await new Promise((resolve) => independent.listen(0, '127.0.0.1', resolve));
  t.after(() => { independent.closeAllConnections(); independent.close(); });
  const child = launchDevService(root, { name: 'test service', script: 'dev' }, process.env, root);
  t.after(() => child.stop());
  const deadline = Date.now() + 10_000;
  while (!existsSync(path.join(root, 'port')) && Date.now() < deadline) {
    if (child.failure()) throw child.failure();
    await delay(50);
  }
  const url = `http://127.0.0.1:${readFileSync(path.join(root, 'port'), 'utf8')}`;
  const accepts = (value) => value.application === 'owned-test-service';
  assert.equal((await probeDevHttp(url, accepts)).state, 'ready');
  await child.stop();
  await child.done;
  assert.equal((await probeDevHttp(url, accepts)).state, 'missing');
  assert.equal(await (await fetch(`http://127.0.0.1:${independent.address().port}`)).text(), 'alive');
});
