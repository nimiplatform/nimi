import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createDesktopFinalExit } from '../src-electron/desktop-final-exit.js';
import { DesktopShutdownBlockedError, runDesktopProductShutdown } from '../src-electron/product-update-shutdown.js';
import { createDesktopQuitCoordinator } from '../src-electron/system-entry-quit-coordinator.js';

const mainSource = await readFile(new URL('../src-electron/main.ts', import.meta.url), 'utf8');
const mainTree = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);

function mainFunctions(...names: string[]): string {
  const declarations = names.map((name) => {
    const declaration = mainTree.statements.find((statement) => (
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
    ));
    assert.ok(declaration, `missing production function ${name}`);
    return declaration.getText(mainTree);
  });
  return ts.transpileModule(declarations.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

const finalExitDeclaration = mainTree.statements.find((statement) => (
  ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => (
    ts.isIdentifier(declaration.name) && declaration.name.text === 'desktopFinalExit'
  ))
));
const willQuitRegistration = mainTree.statements.find((statement) => {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const call = statement.expression;
  return ts.isPropertyAccessExpression(call.expression) && call.expression.expression.getText(mainTree) === 'app'
    && call.expression.name.text === 'on' && call.arguments[0]?.getText(mainTree) === "'will-quit'";
});
assert.ok(finalExitDeclaration, 'main must own final IPC teardown');
assert.ok(willQuitRegistration, 'main must defer ordinary IPC teardown until will-quit');

function shutdownFixture(stopLocal: () => Promise<void> = async () => {}) {
  let registered = true;
  let unregisterCount = 0;
  let quitCount = 0;
  const exits: number[] = [];
  const listeners = new Map<string, () => void>();
  const bridge = {
    disposeFormalAppResources: async () => {},
    unregister() { registered = false; unregisterCount += 1; },
  };
  const state: Record<string, unknown> = {
    createDesktopFinalExit, runDesktopProductShutdown, DesktopShutdownBlockedError, setTimeout, clearTimeout,
    app: {
      on(event: string, listener: () => void) { listeners.set(event, listener); },
      quit() { quitCount += 1; },
      exit(code: number) { exits.push(code); },
    },
    localDevelopmentHost: { shutdown: stopLocal }, installedAppHost: undefined,
    desktopOpenIntentHost: undefined, bundledAvatarHost: undefined, chatAiStoreHost: undefined,
    systemEntryHost: undefined, connectorAuthAcquisitionHost: undefined,
    registeredRuntimeBridge: bridge, productUpdateHost: undefined,
    DESKTOP_FORMAL_RESOURCE_SHUTDOWN_TIMEOUT_MS: 100,
    homeRelaunchRequested: false,
    stopProductRuntime: async () => {}, maintenanceRelaunchRequested: false,
    homeHostProfile: { mode: 'root' }, homeTemporaryEnvironment: { restore() {} },
    SOURCE_PER_USER_RUNTIME_D2: true, HOME_PROFILE_RELAUNCH_EXIT_CODE: 75,
    releaseDesktopHomeBootstrapSlot: async () => {},
    systemEntryAccountUnsubscribe: undefined, systemEntryAdmission: undefined,
    systemEntryActionRelay: undefined, systemEntryRendererReady: true,
    powerMonitor: { removeListener() {} },
    lockDesktopSystemEntry() {}, unlockDesktopSystemEntry() {}, suspendDesktopSystemEntry() {},
    resumeDesktopSystemEntry() {}, handleDesktopSystemSessionEnd() {}, writeDesktopStderr() {},
  };
  // Run actual main-process wiring and cleanup without booting Electron or touching a Runtime.
  const setup = ts.transpileModule(
    `${finalExitDeclaration!.getText(mainTree)}\n${willQuitRegistration!.getText(mainTree)}`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const owner = runInNewContext(
    `${setup}\n${mainFunctions('desktopBootstrapFailureCode', 'shutdownBeforeQuit', 'finishDesktopHomeProfileBeforeExit')}
    ({ shutdownBeforeQuit, finishDesktopHomeProfileBeforeExit });`, state,
  ) as { shutdownBeforeQuit(): Promise<unknown>; finishDesktopHomeProfileBeforeExit(): Promise<void> };
  return {
    bridge, state, exits, shutdown: owner.shutdownBeforeQuit, finishHomeProfile: owner.finishDesktopHomeProfileBeforeExit,
    finishNativeQuit: () => { listeners.get('will-quit')!(); },
    quitCount: () => quitCount,
    unregisterCount: () => unregisterCount,
    invokeFromStillOpenRenderer: () => {
      if (!registered) throw new Error("No handler registered for 'nimi:runtime:invoke'");
      return 'current-owner-read';
    },
  };
}

test('resource cleanup retains the IPC owner while Home can still send its final observations', async () => {
  const fixture = shutdownFixture();
  await fixture.shutdown();
  assert.equal(fixture.state.registeredRuntimeBridge, fixture.bridge);
  assert.equal(fixture.unregisterCount(), 0);
  assert.equal(fixture.invokeFromStillOpenRenderer(), 'current-owner-read');
  await fixture.finishHomeProfile();
  assert.equal(fixture.quitCount(), 1);
  assert.equal(fixture.state.registeredRuntimeBridge, fixture.bridge);
  fixture.finishNativeQuit();
  fixture.finishNativeQuit();
  assert.equal(fixture.state.registeredRuntimeBridge, undefined);
  assert.equal(fixture.unregisterCount(), 1);
});

test('failed critical quit preserves the bridge for a real retry and never finalizes', async () => {
  let attempts = 0;
  let recoveries = 0;
  const fixture = shutdownFixture(async () => {
    if (++attempts === 1) throw new Error('app-stop-failed');
  });
  const coordinator = createDesktopQuitCoordinator({
    readImpact: async () => ({ apps: 1 }), confirm: async () => true,
    shutdown: async () => { await fixture.shutdown(); },
    finishQuit: fixture.finishHomeProfile,
    recoverAfterFailedQuit: () => { recoveries += 1; },
  });
  await assert.rejects(coordinator.requestUserQuit(), DesktopShutdownBlockedError);
  assert.equal(coordinator.phase(), 'idle');
  assert.equal(recoveries, 1);
  assert.equal(fixture.quitCount(), 0);
  assert.equal(fixture.unregisterCount(), 0);
  assert.equal(fixture.state.registeredRuntimeBridge, fixture.bridge);
  assert.equal(fixture.invokeFromStillOpenRenderer(), 'current-owner-read');
  assert.equal(await coordinator.requestUserQuit(), true);
  assert.equal(fixture.quitCount(), 1);
  assert.equal(fixture.unregisterCount(), 0);
  fixture.finishNativeQuit();
  assert.equal(fixture.unregisterCount(), 1);
});

test('both SOURCE relaunch paths finish profile waits before synchronous IPC teardown and exit', async () => {
  for (const mode of ['home', 'maintenance'] as const) {
    const fixture = shutdownFixture();
    let release!: () => void;
    const releasing = new Promise<void>((resolve) => { release = resolve; });
    fixture.state.homeHostProfile = { mode: 'bootstrap', profileRoot: 'task-owned-profile' };
    fixture.state.releaseDesktopHomeBootstrapSlot = () => releasing;
    fixture.state.homeRelaunchRequested = mode === 'home';
    fixture.state.maintenanceRelaunchRequested = mode === 'maintenance';
    const finishing = fixture.finishHomeProfile();
    await Promise.resolve();
    assert.equal(fixture.state.registeredRuntimeBridge, fixture.bridge);
    assert.equal(fixture.unregisterCount(), 0);
    assert.deepEqual(fixture.exits, []);
    release();
    await finishing;
    assert.equal(fixture.state.registeredRuntimeBridge, undefined);
    assert.equal(fixture.unregisterCount(), 1);
    assert.deepEqual(fixture.exits, [75]);
    assert.equal(fixture.quitCount(), 0);
    fixture.finishNativeQuit();
    assert.equal(fixture.unregisterCount(), 1);
  }
});

test('forced exit remains synchronous when unregister fails and reports only a bounded diagnostic', async () => {
  for (const [message, expected] of [
    ['bridge-release-failed', 'bridge-release-failed'], ['private path or unexpected error details', 'cleanup-failed'],
  ]) {
    const calls: string[] = [];
    const owner = createDesktopFinalExit({
      takeRuntimeBridge: () => ({ unregister() {
        calls.push('unregister');
        queueMicrotask(() => { calls.push('later'); });
        throw new Error(message);
      } }),
      reportDiagnostic: (reason) => { calls.push(`diagnostic:${reason}`); },
      exit: (code) => { calls.push(`exit:${code}`); },
    });
    owner.exit(1);
    owner.finish();
    assert.deepEqual(calls, ['unregister', `diagnostic:${expected}`, 'exit:1']);
    await Promise.resolve();
    assert.deepEqual(calls, ['unregister', `diagnostic:${expected}`, 'exit:1', 'later']);
  }
});

test('early forced exit is valid before any Runtime bridge was registered', () => {
  const exits: number[] = [];
  const owner = createDesktopFinalExit({
    takeRuntimeBridge: () => undefined,
    reportDiagnostic: () => assert.fail('no cleanup should fail'),
    exit: (code) => { exits.push(code); },
  });
  owner.exit(1);
  owner.finish();
  assert.deepEqual(exits, [1]);
});

test('all direct Electron exit calls delegate through the finalizer installed before startup exits', () => {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'exit') calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(mainTree);
  const raw = calls.filter((call) => (call.expression as ts.PropertyAccessExpression).expression.getText(mainTree) === 'app');
  assert.equal(raw.length, 1, 'a direct app.exit outside the finalizer bypasses IPC cleanup');
  assert.ok(raw[0]!.pos >= finalExitDeclaration!.pos && raw[0]!.end <= finalExitDeclaration!.end);
  const routed = calls.filter((call) => (call.expression as ts.PropertyAccessExpression).expression.getText(mainTree) === 'desktopFinalExit');
  assert.equal(routed.length, 6, 'cover startup refusal, service unregister, bootstrap failure, OS shutdown and both SOURCE relaunches');
  assert.ok(routed.every((call) => call.pos > willQuitRegistration!.end));
});
