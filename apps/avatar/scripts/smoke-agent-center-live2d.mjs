import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function normalize(value) {
  return String(value || '').trim();
}

class SmokePreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SmokePreflightError';
  }
}

function live2dSmokeRepairMessage(accountsRoot) {
  return [
    `[avatar-live2d-smoke] missing local Agent Center Live2D data under: ${accountsRoot}`,
    '[avatar-live2d-smoke] Fix one of:',
    '  - set NIMI_DATA_ROOT to the desktop data root that contains accounts/<account>/agents/<agent>/agent-center/config.json',
    '  - open Desktop, import/select a local Live2D Avatar asset for the target agent, then rerun this smoke',
    '  - set NIMI_AVATAR_SMOKE_ACCOUNT_ID and NIMI_AVATAR_SMOKE_AGENT_ID for an existing configured agent',
  ].join('\n');
}

function canUseRawPathSegment(value) {
  const body = value.startsWith('~') ? value.slice(1) : value;
  if (!body || value.length > 128) return false;
  if (!/^[a-z0-9]/.test(body)) return false;
  return /^[a-z0-9_-]+$/.test(body);
}

function scopePathSegment(value) {
  if (canUseRawPathSegment(value)) return value;
  return `id_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertSafeRelativeFileRef(root, ref, label) {
  if (!ref || ref.includes('\0') || isAbsolute(ref)) {
    throw new Error(`${label} must be a relative file ref: ${ref}`);
  }
  const resolved = resolve(root, ref);
  const rel = relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`${label} escapes asset root: ${ref}`);
  }
  return resolved;
}

function findConfiguredAgent(dataRoot, explicitAccountId, explicitAgentId) {
  const accountsRoot = join(dataRoot, 'accounts');
  if (!existsSync(accountsRoot) || !statSync(accountsRoot).isDirectory()) {
    throw new SmokePreflightError(live2dSmokeRepairMessage(accountsRoot));
  }

  if (explicitAccountId && explicitAgentId) {
    const configPath = join(
      accountsRoot,
      scopePathSegment(explicitAccountId),
      'agents',
      scopePathSegment(explicitAgentId),
      'agent-center',
      'config.json',
    );
    if (!existsSync(configPath)) {
      throw new SmokePreflightError([
        `[avatar-live2d-smoke] explicit Agent Center config does not exist: ${configPath}`,
        `[avatar-live2d-smoke] NIMI_AVATAR_SMOKE_ACCOUNT_ID=${explicitAccountId}`,
        `[avatar-live2d-smoke] NIMI_AVATAR_SMOKE_AGENT_ID=${explicitAgentId}`,
        '[avatar-live2d-smoke] Import/select a local Live2D Avatar asset for that agent in Desktop, or point the env vars at a configured agent.',
      ].join('\n'));
    }
    return {
      accountId: explicitAccountId,
      agentId: explicitAgentId,
      configPath,
    };
  }

  for (const accountSegment of readdirSync(accountsRoot)) {
    const agentsRoot = join(accountsRoot, accountSegment, 'agents');
    if (!existsSync(agentsRoot) || !statSync(agentsRoot).isDirectory()) continue;
    for (const agentSegment of readdirSync(agentsRoot)) {
      const configPath = join(agentsRoot, agentSegment, 'agent-center', 'config.json');
      if (!existsSync(configPath)) continue;
      const config = readJson(configPath);
      const selected = config.modules?.avatar_asset;
      if (
        selected?.backend_kind === 'live2d'
        && normalize(selected.local_avatar_asset_ref)
      ) {
        return {
          accountId: normalize(config.account_id),
          agentId: normalize(config.agent_id),
          configPath,
        };
      }
    }
  }
  throw new SmokePreflightError([
    `[avatar-live2d-smoke] no Agent Center config with a selected local Live2D Avatar asset was found under: ${accountsRoot}`,
    '[avatar-live2d-smoke] Open Desktop, import/select a local Live2D Avatar asset for an agent, then rerun this smoke.',
    '[avatar-live2d-smoke] To target a specific agent, set NIMI_AVATAR_SMOKE_ACCOUNT_ID and NIMI_AVATAR_SMOKE_AGENT_ID.',
  ].join('\n'));
}

function main() {
  const dataRoot = resolve(process.env.NIMI_DATA_ROOT || join(homedir(), '.nimi', 'data'));
  const target = findConfiguredAgent(
    dataRoot,
    normalize(process.env.NIMI_AVATAR_SMOKE_ACCOUNT_ID),
    normalize(process.env.NIMI_AVATAR_SMOKE_AGENT_ID),
  );
  const config = readJson(target.configPath);
  const selected = config.modules?.avatar_asset;
  const localAssetRef = normalize(selected?.local_avatar_asset_ref);
  if (selected?.backend_kind !== 'live2d' || !localAssetRef) {
    throw new SmokePreflightError([
      `[avatar-live2d-smoke] Agent Center config has no selected local Live2D Avatar asset: ${target.configPath}`,
      '[avatar-live2d-smoke] Select/import a local Live2D Avatar asset for this agent in Desktop, then rerun this smoke.',
    ].join('\n'));
  }
  if (!canUseRawPathSegment(localAssetRef)) {
    throw new Error(`Live2D local Avatar asset ref is not a safe package segment: ${localAssetRef}`);
  }
  const assetRoot = join(
    dataRoot,
    'accounts',
    scopePathSegment(target.accountId),
    'agents',
    scopePathSegment(target.agentId),
    'agent-center',
    'modules',
    'avatar_asset',
    'packages',
    'live2d',
    localAssetRef,
  );
  const manifestPath = join(assetRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new SmokePreflightError([
      `[avatar-live2d-smoke] Live2D local Avatar asset manifest is missing: ${manifestPath}`,
      '[avatar-live2d-smoke] Reimport the local Live2D Avatar asset in Desktop, then rerun this smoke.',
    ].join('\n'));
  }
  const manifest = readJson(manifestPath);
  const entryFile = normalize(manifest.entry_file);
  if (!entryFile.startsWith('files/') || !entryFile.endsWith('.model3.json')) {
    throw new Error(`Live2D manifest entry_file is not a model3 entry under files/: ${entryFile}`);
  }
  const filesRoot = resolve(assetRoot, 'files');
  const model3Path = assertSafeRelativeFileRef(assetRoot, entryFile, 'Live2D manifest entry_file');
  if (!model3Path.startsWith(`${filesRoot}${sep}`)) {
    throw new Error(`Live2D manifest entry_file escapes files/: ${entryFile}`);
  }
  if (!existsSync(model3Path)) {
    throw new SmokePreflightError([
      `[avatar-live2d-smoke] Live2D model3 entry is missing: ${model3Path}`,
      '[avatar-live2d-smoke] Reimport the local Live2D Avatar asset in Desktop, then rerun this smoke.',
    ].join('\n'));
  }
  const model3 = readJson(model3Path);
  if (typeof model3.Version !== 'number') {
    throw new Error(`Live2D model3 entry is missing Version: ${model3Path}`);
  }
  const launchContext = {
    agent_id: target.agentId,
  };
  console.log(JSON.stringify({
    status: 'ok',
    data_root: dataRoot,
    account_id: target.accountId,
    account_path_segment: scopePathSegment(target.accountId),
    agent_id: target.agentId,
    agent_path_segment: scopePathSegment(target.agentId),
    config_path: target.configPath,
    local_avatar_asset_ref: localAssetRef,
    backend_capability_profile_ref: normalize(selected.backend_capability_profile_ref),
    asset_root: assetRoot,
    manifest_path: manifestPath,
    model3_path: model3Path,
    launch_context: launchContext,
  }, null, 2));
}

try {
  main();
} catch (error) {
  if (error instanceof SmokePreflightError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    console.error(error instanceof Error ? (error.stack || error.message) : String(error));
    process.exitCode = 1;
  }
}
