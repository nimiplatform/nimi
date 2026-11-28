import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import {
  DesktopSourceRuntimeUnavailableError,
  sourceRuntimeBootstrapFailureMessage,
} from '../src-electron/source-runtime-bootstrap.js';

const mainSource = await readFile(new URL('../src-electron/main.ts', import.meta.url), 'utf8');
const mainTree = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);

function transpileMainFunctions(...names: string[]): string {
  const declarations = names.map((name) => {
    const declaration = mainTree.statements.find((statement) => (
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
    ));
    assert.ok(declaration, `missing production function ${name}`);
    return declaration.getText(mainTree);
  });
  const sourceText = declarations.join('\n').replaceAll('import.meta.url', JSON.stringify('file:///mock/main.js'));
  return ts.transpileModule(sourceText, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

type BootstrapFailurePresentation = Readonly<{
  readonly failureCode: string;
  readonly failureMessage: string;
  readonly isSourceRuntimeUnavailable: boolean;
  readonly stderrLines: readonly string[];
  readonly dialog: Readonly<{ readonly title: string; readonly message: string }> | null;
}>;

function loadBootstrapFailureHelpers() {
  const code = transpileMainFunctions(
    'createDesktopBootstrapError',
    'desktopBootstrapFailureCode',
    'desktopBootstrapFailureMessage',
    'extractBootstrapErrorText',
    'resolveDesktopBootstrapFailurePresentation',
  );
  return runInNewContext(
    `${code}\n({ createDesktopBootstrapError, desktopBootstrapFailureCode, desktopBootstrapFailureMessage, resolveDesktopBootstrapFailurePresentation });`,
    {
      DesktopSourceRuntimeUnavailableError,
      sourceRuntimeBootstrapFailureMessage,
    },
  ) as {
    createDesktopBootstrapError(reasonCode: string, message: string): Error & { readonly reasonCode: string };
    desktopBootstrapFailureCode(error: unknown): string;
    desktopBootstrapFailureMessage(error: unknown): string;
    resolveDesktopBootstrapFailurePresentation(
      error: unknown,
      options: Readonly<{
        readonly sourcePerUserRuntimeD2: boolean;
        readonly macOSLocalDevelopmentBuild: boolean;
        readonly avatarOnlyDevelopmentMode: boolean;
      }>,
    ): BootstrapFailurePresentation;
  };
}

function loadBootstrapHostCatchFixture(options: {
  readonly sourcePerUserRuntimeD2: boolean;
  readonly macOSLocalDevelopmentBuild: boolean;
  readonly avatarOnlyDevelopmentMode: boolean;
  readonly agentReferences?: ReadonlyArray<{ readonly agentHandle: string }>;
  readonly bootstrapError?: unknown;
}) {
  const stderr: string[] = [];
  const dialogs: Array<{ readonly title: string; readonly message: string }> = [];
  const exits: number[] = [];
  let shutdownCalled = 0;

  const code = transpileMainFunctions(
    'bootstrapDesktopElectronHost',
    'createDesktopBootstrapError',
    'desktopBootstrapFailureCode',
    'desktopBootstrapFailureMessage',
    'extractBootstrapErrorText',
    'resolveDesktopBootstrapFailurePresentation',
    'normalizeText',
  );

  const state: Record<string, unknown> = {
    DesktopSourceRuntimeUnavailableError,
    sourceRuntimeBootstrapFailureMessage,
    SOURCE_PER_USER_RUNTIME_D2: options.sourcePerUserRuntimeD2,
    MACOS_LOCAL_DEVELOPMENT_BUILD: options.macOSLocalDevelopmentBuild,
    AVATAR_ONLY_DEVELOPMENT_MODE: options.avatarOnlyDevelopmentMode,
    app: {
      whenReady: async () => {
        if (options.bootstrapError !== undefined) {
          throw options.bootstrapError;
        }
      },
      getPath: () => '/tmp/unused',
      getLocale: () => 'en-US',
      isPackaged: false,
      on: () => undefined,
    },
    shutdownBeforeQuit: async () => {
      shutdownCalled += 1;
    },
    writeDesktopStderr: (line: string) => {
      stderr.push(line);
    },
    dialog: {
      showErrorBox: (title: string, message: string) => {
        dialogs.push({ title, message });
      },
    },
    desktopFinalExit: {
      exit: (codeValue: number) => {
        exits.push(codeValue);
      },
    },
    process: {
      platform: 'darwin',
      arch: 'arm64',
      env: {},
    },
  };

  const runner = runInNewContext(
    `${code}\n({ bootstrapDesktopElectronHost });`,
    state,
  ) as { bootstrapDesktopElectronHost(): Promise<void> };

  return {
    run: () => runner.bootstrapDesktopElectronHost(),
    stderr,
    dialogs,
    exits,
    shutdownCalled: () => shutdownCalled,
  };
}

test('Source Runtime unavailable message is gated strictly on DesktopSourceRuntimeUnavailableError', () => {
  const helpers = loadBootstrapFailureHelpers();

  const sourceError = new DesktopSourceRuntimeUnavailableError(
    Object.assign(new Error('runtime-service-unavailable'), {
      reasonCode: 'runtime-service-unavailable',
    }),
  );
  const sourceReport = helpers.resolveDesktopBootstrapFailurePresentation(sourceError, {
    sourcePerUserRuntimeD2: true,
    macOSLocalDevelopmentBuild: false,
    avatarOnlyDevelopmentMode: false,
  });
  assert.equal(sourceReport.isSourceRuntimeUnavailable, true);
  assert.equal(sourceReport.failureCode, 'source-local-development-runtime-unavailable');
  assert.match(sourceReport.failureMessage, /Source Runtime connection failed \(runtime-service-unavailable\)/u);
  assert.ok(sourceReport.dialog);
  assert.match(sourceReport.dialog.message, /Source Runtime connection failed \(runtime-service-unavailable\)/u);
  assert.match(sourceReport.dialog.message, /pnpm dev:runtime/u);

  const nonRuntimeError = new Error('Local companion catalog failed to initialize.');
  const nonRuntimeReport = helpers.resolveDesktopBootstrapFailurePresentation(nonRuntimeError, {
    sourcePerUserRuntimeD2: true,
    macOSLocalDevelopmentBuild: false,
    avatarOnlyDevelopmentMode: false,
  });
  assert.equal(nonRuntimeReport.isSourceRuntimeUnavailable, false);
  assert.equal(nonRuntimeReport.failureCode, 'desktop-bootstrap-failed');
  assert.equal(nonRuntimeReport.failureMessage, 'Local companion catalog failed to initialize.');
  assert.ok(nonRuntimeReport.dialog);
  assert.doesNotMatch(nonRuntimeReport.dialog.message, /Source Runtime connection failed/u);
  assert.match(nonRuntimeReport.dialog.message, /Local companion catalog failed to initialize\./u);
  assert.ok(
    nonRuntimeReport.stderrLines.some((line) => line.includes('Local companion catalog failed to initialize.')),
  );
});

test('AVATAR_ONLY_DEVELOPMENT_MODE skips blocking dialog.showErrorBox and emits structured stderr diagnostics', () => {
  const helpers = loadBootstrapFailureHelpers();
  const missingPartnerError = helpers.createDesktopBootstrapError(
    'avatar-only-no-partner-available',
    'Avatar-only Electron dev requires at least one local partner, but 0 formal App Agent references are present. Add a local partner in Nimi Home first.',
  );

  const report = helpers.resolveDesktopBootstrapFailurePresentation(missingPartnerError, {
    sourcePerUserRuntimeD2: true,
    macOSLocalDevelopmentBuild: false,
    avatarOnlyDevelopmentMode: true,
  });
  assert.equal(report.dialog, null, 'avatar-only mode must not block on dialog.showErrorBox');
  assert.equal(report.isSourceRuntimeUnavailable, false);
  assert.equal(report.failureCode, 'avatar-only-no-partner-available');
  assert.match(report.failureMessage, /0 formal App Agent references/u);
  assert.doesNotMatch(report.stderrLines.join('\n'), /Source Runtime connection failed/u);

  const jsonLine = report.stderrLines.find((line) => line.startsWith('[desktop-bootstrap] {'));
  assert.ok(jsonLine, 'avatar-only failure must emit structured JSON stderr diagnostic');
  const parsed = JSON.parse(jsonLine.slice('[desktop-bootstrap] '.length)) as Record<string, unknown>;
  assert.deepEqual(parsed, {
    status: 'failed',
    mode: 'avatar-only',
    failureCode: 'avatar-only-no-partner-available',
    message: missingPartnerError.message,
  });
});

test('bootstrapDesktopElectronHost catch path exits cleanly without dialog in avatar-only mode and keeps dialog for dev:desktop', async () => {
  const missingPartner = Object.assign(
    new Error('Avatar-only Electron dev requires at least one local partner, but 0 formal App Agent references are present.'),
    { reasonCode: 'avatar-only-no-partner-available' },
  );
  const avatarOnlyFixture = loadBootstrapHostCatchFixture({
    sourcePerUserRuntimeD2: true,
    macOSLocalDevelopmentBuild: false,
    avatarOnlyDevelopmentMode: true,
    bootstrapError: missingPartner,
  });
  await avatarOnlyFixture.run();
  assert.equal(avatarOnlyFixture.shutdownCalled(), 1);
  assert.deepEqual(avatarOnlyFixture.dialogs, []);
  assert.deepEqual(avatarOnlyFixture.exits, [1]);
  assert.match(avatarOnlyFixture.stderr.join(''), /avatar-only-no-partner-available/u);
  assert.match(avatarOnlyFixture.stderr.join(''), /0 formal App Agent references/u);
  assert.doesNotMatch(avatarOnlyFixture.stderr.join(''), /Source Runtime connection failed/u);

  const runtimeUnavailable = new DesktopSourceRuntimeUnavailableError(
    Object.assign(new Error('runtime-service-unavailable'), {
      reasonCode: 'runtime-service-unavailable',
    }),
  );
  const desktopRuntimeFailureFixture = loadBootstrapHostCatchFixture({
    sourcePerUserRuntimeD2: true,
    macOSLocalDevelopmentBuild: false,
    avatarOnlyDevelopmentMode: false,
    bootstrapError: runtimeUnavailable,
  });
  await desktopRuntimeFailureFixture.run();
  assert.equal(desktopRuntimeFailureFixture.dialogs.length, 1);
  assert.match(desktopRuntimeFailureFixture.dialogs[0]!.message, /Source Runtime connection failed/u);
  assert.deepEqual(desktopRuntimeFailureFixture.exits, [1]);

  const otherDesktopFailureFixture = loadBootstrapHostCatchFixture({
    sourcePerUserRuntimeD2: true,
    macOSLocalDevelopmentBuild: false,
    avatarOnlyDevelopmentMode: false,
    bootstrapError: new Error('Unexpected local host startup error.'),
  });
  await otherDesktopFailureFixture.run();
  assert.equal(otherDesktopFailureFixture.dialogs.length, 1);
  assert.doesNotMatch(otherDesktopFailureFixture.dialogs[0]!.message, /Source Runtime connection failed/u);
  assert.match(otherDesktopFailureFixture.dialogs[0]!.message, /Unexpected local host startup error\./u);
  assert.deepEqual(otherDesktopFailureFixture.exits, [1]);
});

test('packaged production and macOS local development error dialogs remain intact', () => {
  const helpers = loadBootstrapFailureHelpers();
  const error = new Error('Native carrier signature check failed.');

  const packagedReport = helpers.resolveDesktopBootstrapFailurePresentation(error, {
    sourcePerUserRuntimeD2: false,
    macOSLocalDevelopmentBuild: false,
    avatarOnlyDevelopmentMode: false,
  });
  assert.ok(packagedReport.dialog);
  assert.equal(
    packagedReport.dialog.message,
    'The verified Desktop carrier could not be initialized. Repair the Nimi installation and try again.',
  );
  assert.ok(
    packagedReport.stderrLines.some((line) => line.includes('Native carrier signature check failed.')),
  );

  const macLocalDevReport = helpers.resolveDesktopBootstrapFailurePresentation(error, {
    sourcePerUserRuntimeD2: false,
    macOSLocalDevelopmentBuild: true,
    avatarOnlyDevelopmentMode: false,
  });
  assert.ok(macLocalDevReport.dialog);
  assert.match(macLocalDevReport.dialog.message, /Nimi Dev bootstrap failed \(desktop-bootstrap-failed\)/u);
  assert.match(macLocalDevReport.dialog.message, /Native carrier signature check failed\./u);
});

test('main.ts avatar-only 0-partner path throws structured missing-partner error and host locale store is wired', () => {
  assert.match(mainSource, /avatar-only-no-partner-available/u);
  assert.match(mainSource, /desktopHostLocaleStore = createDesktopHostLocaleStore\(/u);
  assert.match(mainSource, /systemEntryLocale = await desktopHostLocaleStore\.initialize\(app\.getLocale\(\)\)/u);
  assert.match(mainSource, /await desktopHostLocaleStore\?\.sync\(nextLocale\)/u);
});
