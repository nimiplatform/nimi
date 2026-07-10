import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { resolveElectronStandardDataRoot } from './data-root-binding.js';
import { parseAccountScope, parseLocalAgentScope } from './agent-center-contract.js';
import {
  accountDir,
  agentCenterDir,
  assertManagedPath,
  managedPathExists,
  quarantine,
  resolveBoundDataRoot,
} from './agent-center-paths.js';
import type { NimiElectronStandardShellHost } from './types.js';

export async function removeAgentResources(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await boundDataRoot(host, command);
  const scope = parseLocalAgentScope(payload, command);
  const root = agentCenterDir(dataRoot, scope);
  if (!await managedPathExists(dataRoot, root, command)) {
    return { removed: false };
  }
  await quarantine(
    dataRoot,
    accountDir(dataRoot, scope.accountId),
    root,
    'agent_local_resources',
    scope.localAgentRef,
    command,
  );
  return { removed: true };
}

export async function removeAccountResources(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
) {
  const dataRoot = await boundDataRoot(host, command);
  const accountId = parseAccountScope(payload, command);
  const root = accountDir(dataRoot, accountId);
  const agentsRoot = path.join(root, 'agents');
  if (!await managedPathExists(dataRoot, agentsRoot, command)) {
    return { removed: false };
  }
  await assertManagedPath(dataRoot, agentsRoot, command);
  let removed = false;
  for (const entry of await readdir(agentsRoot, { withFileTypes: true })) {
    const agentPath = path.join(agentsRoot, entry.name);
    if (entry.isSymbolicLink()) {
      await assertManagedPath(dataRoot, agentPath, command);
    }
    if (!entry.isDirectory()) continue;
    const agentCenterRoot = path.join(agentPath, 'agent-center');
    if (!await managedPathExists(dataRoot, agentCenterRoot, command)) continue;
    await quarantine(dataRoot, root, agentCenterRoot, 'agent_local_resources', entry.name, command);
    removed = true;
  }
  return { removed };
}

async function boundDataRoot(host: NimiElectronStandardShellHost | undefined, command: string): Promise<string> {
  return resolveBoundDataRoot(await resolveElectronStandardDataRoot(host, command), command);
}
