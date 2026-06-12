import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function normalize(value) {
  return String(value || '').trim();
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
  if (explicitAccountId && explicitAgentId) {
    return {
      accountId: explicitAccountId,
      agentId: explicitAgentId,
      configPath: join(
        accountsRoot,
        scopePathSegment(explicitAccountId),
        'agents',
        scopePathSegment(explicitAgentId),
        'agent-center',
        'config.json',
      ),
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
  throw new Error(`No Agent Center Live2D config found under ${accountsRoot}`);
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
    throw new Error(`Agent Center config has no selected Live2D local Avatar asset: ${target.configPath}`);
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
    throw new Error(`Live2D local Avatar asset manifest is missing: ${manifestPath}`);
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
    throw new Error(`Live2D model3 entry is missing: ${model3Path}`);
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

main();
