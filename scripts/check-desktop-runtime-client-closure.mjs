import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  compileFirstPartyProtectedRuntimeProfiles,
  MANIFEST_RELATIVE,
  RPC_SOURCE_RELATIVE,
  SOURCE_RELATIVE,
} from './lib/first-party-protected-runtime-profile-compiler.mjs';

const root = process.cwd();
const desktopRoot = path.join(root, 'apps', 'desktop');
const desktopSourceRoot = path.join(desktopRoot, 'src');
const sessionRelative = 'apps/desktop/src/shell/renderer/infra/sdk/desktop-nimi-client-session.ts';
const clientRelative = 'sdks/typescript/runtime/desktop-first-party-runtime.ts';
const generatedRelative = 'sdks/typescript/runtime/first-party-protected-runtime-profiles.generated.ts';
const runtimeAgentClientRelative = 'sdks/typescript/runtime/runtime-agent-client.ts';
const retainedLifecycleDiscoveryConsumer = 'apps/desktop/src/shell/renderer/features/agents/local-agent-list-model.ts';
const excludedDeadSurface = 'apps/desktop/src/shell/renderer/app-shell/providers/desktop-memory-embedding-config-service.ts';
const trackedInputs = [
  SOURCE_RELATIVE,
  RPC_SOURCE_RELATIVE,
  MANIFEST_RELATIVE,
  generatedRelative,
  clientRelative,
  runtimeAgentClientRelative,
  sessionRelative,
];

const errors = [];
assertTrackedInputs();

const compiled = compileFirstPartyProtectedRuntimeProfiles({ repoRoot: root });
const generated = read(generatedRelative);
const client = read(clientRelative);
const session = read(sessionRelative);
const runtimeAgentClient = read(runtimeAgentClientRelative);
const generatedExpected = compiled.outputs.get(generatedRelative);
const manifestExpected = compiled.outputs.get(MANIFEST_RELATIVE);
assert(generated === generatedExpected, `${generatedRelative} does not match tracked canonical inputs`);
assert(read(MANIFEST_RELATIVE) === manifestExpected, `${MANIFEST_RELATIVE} does not match tracked canonical inputs`);

const typedGroups = generated.slice(generated.indexOf('NIMI_FIRST_PARTY_PROTECTED_RUNTIME_TYPED_METHOD_GROUPS'));
const machineMethods = readGeneratedGroup('desktop_machine_product_v1');
const accountMethods = readGeneratedGroup('desktop_account_product_v1');
const canonicalMachineMethods = readCanonicalGroup('desktop_machine_product_v1');
const canonicalAccountMethods = readCanonicalGroup('desktop_account_product_v1');
assertSameMethods(machineMethods, canonicalMachineMethods, 'machine');
assertSameMethods(accountMethods, canonicalAccountMethods, 'account');
assert(machineMethods.length === 64, `machine generated method count is ${machineMethods.length}, expected 64`);
assert(accountMethods.length === 49, `account generated method count is ${accountMethods.length}, expected 49`);
assert(machineMethods.includes('importLocalAsset'), 'real negative fixture importLocalAsset is missing from the machine profile');
assert(!accountMethods.includes('importLocalAsset'), 'machine-only importLocalAsset entered the account profile');
assert(/\binitializeAgent\s*\(/u.test(runtimeAgentClient), 'real negative fixture initializeAgent is missing from the Runtime SDK');
assert(!machineMethods.includes('initializeAgent'), 'profile-external initializeAgent entered the machine profile');
assert(!accountMethods.includes('initializeAgent'), 'profile-external initializeAgent entered the account profile');

assert(client.includes('DesktopMachineProductRuntimeMethods'), 'SDK machine product client is not derived from the generated method type');
assert(client.includes('DesktopAccountProductRuntimeMethods'), 'SDK account product client is not derived from the generated method type');
assert(client.includes('NimiRuntimeScenarioJobClient'), 'Desktop AI client is not an exact scenario-job purpose interface');
assert(!/\bNimiDesktopRuntimeOwnerClients\b/u.test(client), 'SDK Desktop client retains a broad owner alias');
assert(!/\breadonly\s+owners\s*:/u.test(client), 'SDK Desktop client retains an alternate owner container');
assert(!/\bRuntime\s*\[/u.test(client), 'SDK Desktop client retains a Runtime service-family alias');
assert(!serviceFamilySpreadPattern().test(client), 'SDK Desktop client spreads a Runtime service family');
assert(client.includes("'machine.route-connectors.list'") && client.includes("'account.connector-admin.list'"), 'dual-profile ListConnectors lacks exact generated named intents');
assert(!/listConnectors:\s*runtime\.connectors\.listConnectors/gu.test(client), 'ListConnectors fell back to method-precedence routing');

assert(!/createNimiRuntimePlatformClient|createNimiClient\s*\(/u.test(session), 'Desktop session constructs a broad Runtime/Nimi client');
assert(!/\btype\s+Runtime\b|\bas\s+Runtime\b|\bRuntime\s*\[/u.test(session), 'Desktop session retains a full Runtime type/cast/index');
assert(!/runtimeClients\.owners\b/u.test(session), 'Desktop session retains an alternate owner path');
assert(!serviceFamilySpreadPattern().test(session), 'Desktop session spreads a Runtime service family');

const productionFiles = walk(desktopSourceRoot).filter((file) => /\.[cm]?[jt]sx?$/u.test(file));
for (const file of productionFiles) {
  const source = fs.readFileSync(file, 'utf8');
  errors.push(...scanDesktopProductionSource(source, slash(path.relative(root, file))));
}
assert(!fs.existsSync(path.join(root, excludedDeadSurface)), `excluded dead memory lifecycle surface still exists: ${excludedDeadSurface}`);

assert(
  scanDesktopProductionSource("type Escaped = Runtime['agents'];", 'synthetic/broad-owner.ts').length > 0,
  'structural scanner does not reject a broad Runtime service alias',
);
assert(
  scanDesktopProductionSource('const escaped = session.runtimeClients.owners.agentDiagnostics;', 'synthetic/alternate-owner.ts').length > 0,
  'structural scanner does not reject an alternate-owner bypass',
);
assert(
  scanDesktopProductionSource('getDesktopHostRuntimeAgentClient().agent.initializeAgent({});', 'synthetic/profile-external.ts').length > 0,
  'structural scanner does not reject a profile-external getter',
);

runNegativeTypeBuild();

if (errors.length > 0) {
  for (const error of errors) console.error(`[desktop-runtime-client-closure] ${error}`);
  process.exit(1);
}
console.log(`[desktop-runtime-client-closure] passed (tracked canonical/generated inputs; productionFiles=${productionFiles.length}; machine=${machineMethods.length}; account=${accountMethods.length}; negativeTypeBuild=passed)`);

function assertTrackedInputs() {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', ...trackedInputs], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert(result.status === 0, `closure inputs must be tracked: ${(result.stderr || result.stdout || '').trim()}`);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function readGeneratedGroup(profileId) {
  const match = typedGroups.match(new RegExp(`"${profileId}": (\\[[^\\n]+\\])`, 'u'));
  if (!match) return [];
  return JSON.parse(match[1]);
}

function readCanonicalGroup(profileId) {
  return compiled.model.profiles
    .find((profile) => profile.profileId === profileId)
    ?.methods.map((method) => method.methodName) ?? [];
}

function assertSameMethods(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert(JSON.stringify(actualSorted) === JSON.stringify(expectedSorted), `${label} generated typed methods diverge from canonical profile membership`);
}

function serviceFamilySpreadPattern() {
  return /\.\.\.\s*(?:runtime|clients(?:\.[A-Za-z][A-Za-z0-9_]*)+|session\.runtimeClients(?:\.[A-Za-z][A-Za-z0-9_]*)+)\.(?:appLifecycle|memory|connectors|local|audit|ai|externalAgents|agents|auth)\b/u;
}

function scanDesktopProductionSource(source, relative) {
  const findings = [];
  if (/\bgetDesktopRuntime\b/u.test(source)) findings.push(`${relative}: broad getDesktopRuntime symbol remains`);
  if (/\bas\s+Runtime\b/u.test(source)) findings.push(`${relative}: full Runtime cast remains`);
  if (/\bRuntime\s*\[/u.test(source)) findings.push(`${relative}: Runtime service-family alias remains`);
  if (/import(?:\s+type)?\s*\{[^}]*\bRuntime\b[^}]*\}\s*from\s*['"]@nimiplatform\/sdk\/runtime['"]/su.test(source)) {
    findings.push(`${relative}: full Runtime import remains`);
  }
  if (/\b(?:readonly\s+)?runtime\??\s*:\s*Runtime\b/u.test(source)) findings.push(`${relative}: full Runtime field/return remains`);
  if (/runtimeClients\.owners\b/u.test(source)) findings.push(`${relative}: alternate Runtime owner path remains`);
  if (/\binitializeAgent\s*\(/u.test(source)) findings.push(`${relative}: profile-external initializeAgent getter remains`);
  if (![sessionRelative, retainedLifecycleDiscoveryConsumer].includes(relative)
    && /\bcreateNimiHostRuntimeAgentLifecycleSurface\b/u.test(source)) {
    findings.push(`${relative}: full Runtime Agent lifecycle factory bypass remains`);
  }
  if (/\b(?:initializeLocalAgent|ensureLocalAgentInitialized|terminateLocalAgent)\s*\(/u.test(source)) {
    findings.push(`${relative}: profile-external Runtime Agent lifecycle operation remains`);
  }
  if (serviceFamilySpreadPattern().test(source)) findings.push(`${relative}: Runtime service-family object spread remains`);
  return findings;
}

function runNegativeTypeBuild() {
  const tempRoot = fs.mkdtempSync(path.join(desktopRoot, '.desktop-runtime-client-closure-'));
  const fixturePath = path.join(tempRoot, 'closure-negative.typecheck.ts');
  const configPath = path.join(tempRoot, 'tsconfig.json');
  const fixture = [
    "import type { NimiDesktopFirstPartyRuntimeClients, Runtime } from '@nimiplatform/sdk/runtime';",
    "import { getDesktopAccountProductClient, getDesktopHostRuntimeAgentClient, getDesktopMachineProductClient, getDesktopRuntimeAgentOwnerClient } from '../src/shell/renderer/infra/sdk/desktop-nimi-client-session';",
    'declare const runtime: Runtime;',
    'void runtime.local.importLocalAsset;',
    'void runtime.agents.initializeAgent;',
    'void getDesktopMachineProductClient().local.importLocalAsset;',
    'void getDesktopAccountProductClient().agents.getAgent;',
    '// @ts-expect-error real machine method must not escape through the account client',
    'void getDesktopAccountProductClient().agents.importLocalAsset;',
    '// @ts-expect-error profile-external Runtime method must not escape through the account client',
    'void getDesktopAccountProductClient().agents.initializeAgent;',
    '// @ts-expect-error purpose-only candidate method must not enter the generated account profile client',
    'void getDesktopAccountProductClient().agents.createRealmGroupMessageCandidate;',
    '// @ts-expect-error alternate Agent owner getter must remain exact',
    'void getDesktopRuntimeAgentOwnerClient().initializeAgent;',
    '// @ts-expect-error composed Desktop host getter must remain discovery/presentation/delegated only',
    'void getDesktopHostRuntimeAgentClient().agent.initializeAgent({} as never);',
    '// @ts-expect-error Desktop client root must not expose a broad owners container',
    "type EscapedOwners = NimiDesktopFirstPartyRuntimeClients['owners'];",
    '',
  ].join('\n');
  const config = {
    extends: '../tsconfig.json',
    compilerOptions: {
      baseUrl: '.',
      composite: false,
      incremental: false,
      noEmit: true,
      paths: {
        '@nimiplatform/sdk/app': ['../../../sdks/typescript/core/app/index.ts'],
        '@nimiplatform/sdk/realm': ['../../../sdks/typescript/realm/index.ts'],
        '@nimiplatform/sdk/runtime': ['../../../sdks/typescript/runtime/index.ts'],
        '@nimiplatform/sdk/runtime/generated': ['../../../sdks/typescript/runtime/generated.ts'],
        '@nimiplatform/sdk/types': ['../../../sdks/typescript/types/index.ts'],
        '@nimiplatform/kit/core/*': ['../../../kit/core/src/*'],
        '@nimiplatform/kit/shell/capabilities': ['../../../kit/shell/capabilities/src/index.ts'],
        '@nimiplatform/kit/shell/capabilities/*': ['../../../kit/shell/capabilities/src/*'],
        '@nimiplatform/kit/shell/renderer/bridge': ['../../../kit/shell/renderer/src/bridge/index.ts'],
        '@nimiplatform/kit/shell/renderer/bridge/*': ['../../../kit/shell/renderer/src/bridge/*'],
      },
    },
    files: ['./closure-negative.typecheck.ts'],
    include: [],
  };
  try {
    fs.writeFileSync(fixturePath, fixture, 'utf8');
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const pnpmArgs = ['--filter', '@nimiplatform/desktop', 'exec', 'tsc', '-p', configPath, '--pretty', 'false'];
    const pnpmCli = process.env.npm_execpath;
    const command = pnpmCli ? process.execPath : 'pnpm';
    const commandArgs = pnpmCli ? [pnpmCli, ...pnpmArgs] : pnpmArgs;
    const result = spawnSync(command, commandArgs, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) {
      errors.push(`negative TypeScript build failed: ${(result.stdout || result.stderr || result.error?.message || '').trim()}`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else files.push(target);
  }
  return files;
}

function slash(value) {
  return value.split(path.sep).join('/');
}
