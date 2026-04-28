import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

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
      const selected = config.modules?.avatar_package?.selected_package;
      if (selected?.kind === 'live2d' && normalize(selected.package_id)) {
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
  const selected = config.modules?.avatar_package?.selected_package;
  if (selected?.kind !== 'live2d' || !normalize(selected.package_id)) {
    throw new Error(`Agent Center config has no selected Live2D package: ${target.configPath}`);
  }
  const packageRoot = join(
    dataRoot,
    'accounts',
    scopePathSegment(target.accountId),
    'agents',
    scopePathSegment(target.agentId),
    'agent-center',
    'modules',
    'avatar_package',
    'packages',
    'live2d',
    selected.package_id,
  );
  const manifestPath = join(packageRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Live2D package manifest is missing: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  const entryFile = normalize(manifest.entry_file);
  if (!entryFile.startsWith('files/') || !entryFile.endsWith('.model3.json')) {
    throw new Error(`Live2D manifest entry_file is not a model3 entry under files/: ${entryFile}`);
  }
  const model3Path = join(packageRoot, entryFile);
  if (!existsSync(model3Path)) {
    throw new Error(`Live2D model3 entry is missing: ${model3Path}`);
  }
  const model3 = readJson(model3Path);
  if (typeof model3.Version !== 'number') {
    throw new Error(`Live2D model3 entry is missing Version: ${model3Path}`);
  }
  const launchContext = {
    agent_center_account_id: target.accountId,
    agent_id: target.agentId,
    avatar_package_kind: 'live2d',
    avatar_package_id: selected.package_id,
    avatar_package_schema_version: 1,
  };
  console.log(JSON.stringify({
    status: 'ok',
    data_root: dataRoot,
    account_id: target.accountId,
    account_path_segment: scopePathSegment(target.accountId),
    agent_id: target.agentId,
    agent_path_segment: scopePathSegment(target.agentId),
    config_path: target.configPath,
    package_root: packageRoot,
    manifest_path: manifestPath,
    model3_path: model3Path,
    launch_context: launchContext,
  }, null, 2));
}

main();
