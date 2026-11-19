import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { spawnSyncCommand } from '../lib/command-runner.mjs';

// Consume the candidate files from a directory outside every pnpm workspace.
// No candidate resolution may fall through to a registry or a source checkout.
const platform = `${process.platform}-${process.arch}`;
assert.ok(['win32-x64', 'darwin-arm64'].includes(platform), 'requires a supported native package');
assert.equal(process.argv.length, 3, 'supply the directory of packed candidates');
const packages = path.resolve(process.argv[2]);
const root = fs.mkdtempSync(path.join(tmpdir(), 'nimi-candidate-consumer-'));
const app = path.join(root, 'consumer');
const archives = path.join(root, 'archives');
const inputs = ['sdk', 'kit', 'app-tools', 'sdk-adapter-vercel-ai', platform];
const specs = {};
function run(command, args, cwd) {
  const result = spawnSyncCommand(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed`);
}
try {
  fs.mkdirSync(archives);
  for (const input of inputs) {
    const dir = path.join(packages, input);
    const files = fs.readdirSync(dir).filter(file => file.endsWith('.tgz'));
    assert.equal(files.length, 1, `expected one tarball for ${input}`);
    const name = '@nimiplatform/' + (input === platform ? `kit-protected-local-${platform}` : input);
    fs.copyFileSync(path.join(dir, files[0]), path.join(archives, files[0]));
    specs[name] = `file:../archives/${files[0]}`;
  }
  const cli = path.join(root, 'cli');
  fs.mkdirSync(cli);
  fs.writeFileSync(path.join(cli, 'package.json'), '{"private":true}');
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', specs['@nimiplatform/app-tools']], cli);
  const cliPackage = path.join(cli, 'node_modules', '@nimiplatform', 'app-tools');
  const bin = JSON.parse(fs.readFileSync(path.join(cliPackage, 'package.json'))).bin['nimi-app'];
  run(process.execPath, [path.join(cliPackage, bin), 'create', '--dir', app, '--profile', 'standalone', '--title', 'Candidate consumer'], cli);
  const workspaceFile = path.join(app, 'pnpm-workspace.yaml');
  const workspace = fs.existsSync(workspaceFile) ? parse(fs.readFileSync(workspaceFile, 'utf8')) : {};
  fs.writeFileSync(workspaceFile, stringify({ ...workspace, overrides: { ...workspace?.overrides, ...specs } }));
  const manifestFile = path.join(app, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.devDependencies['@nimiplatform/sdk-adapter-vercel-ai'] = specs['@nimiplatform/sdk-adapter-vercel-ai'];
  const native = `@nimiplatform/kit-protected-local-${platform}`;
  manifest.devDependencies[native] = specs[native];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  run('pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts'], app);
  const lock = parse(fs.readFileSync(path.join(app, 'pnpm-lock.yaml'), 'utf8'));
  const installed = {};
  for (const [name, file] of Object.entries(specs)) {
    const bytes = fs.readFileSync(path.resolve(app, file.slice(5)));
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    const entries = Object.entries(lock.packages).filter(([id]) => id.startsWith(name + '@'));
    assert.equal(entries.length, 1, `ambiguous or missing installed ${name}`);
    assert.equal(entries[0][1].resolution.integrity, integrity, name);
    const pkgRoot = fs.realpathSync(path.join(app, 'node_modules', name));
    assert.ok(pkgRoot.startsWith(app + path.sep), name);
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.name, name, `candidate package identity for ${name}`);
    installed[name] = pkg;
  }
  // Local tarball overrides select the bytes but cannot prove that the
  // consumer's original dependency ranges admit those same versions.
  const semver = createRequire(path.join(cliPackage, 'package.json'))('semver');
  const sdk = '@nimiplatform/sdk';
  const kit = '@nimiplatform/kit';
  const adapter = '@nimiplatform/sdk-adapter-vercel-ai';
  const cliName = '@nimiplatform/app-tools';
  for (const name of [sdk, kit, cliName]) {
    const range = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
    assert.ok(semver.satisfies(installed[name].version, range), `generated consumer rejects ${name}@${installed[name].version}: ${range}`);
  }
  assert.ok(semver.satisfies(installed[sdk].version, installed[kit].dependencies[sdk]), 'Kit rejects candidate SDK');
  assert.ok(semver.satisfies(installed[sdk].version, installed[adapter].peerDependencies[sdk]), 'adapter rejects candidate SDK');
  assert.equal(installed[native].version, installed[kit].version, 'native candidate version must match Kit');
  assert.ok(semver.satisfies(installed[native].version, installed[kit].optionalDependencies[native]), 'Kit rejects native candidate');
  run(process.execPath, ['--input-type=module', '-e', `
    import '@nimiplatform/sdk/app';
    import '@nimiplatform/kit/core/app-record-storage';
    import '@nimiplatform/sdk-adapter-vercel-ai';
    import { createRequire } from 'node:module';
    const addon = createRequire(import.meta.url)(${JSON.stringify(native)});
    if (typeof addon.localAppSessionRebind !== 'function') throw Error('native ABI missing');
  `], app);
  console.log(`Verified ${inputs.length} candidate archives on ${platform}`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
