import { describe, expect, it } from 'vitest';

import {
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '../src/index.js';

const FINAL_LOCAL_APP_OPERATIONS = [
  'local-app.sessionStatus',
  'local-app.aiConfigGet',
  'local-app.aiConfigOverwrite',
  'local-app.textGenerateCandidate',
  'local-app.agentReferenceList',
  'local-app.conversationOpen',
  'local-app.conversationSendTurn',
  'local-app.conversationInterruptTurn',
  'local-app.conversationSubscribe',
  'local-app.conversationSnapshot',
  'local-app.sharedAgentAIConfigGet',
  'local-app.sharedAgentAIConfigOverwrite',
  'local-app.agentAutonomySnapshot',
  'local-app.agentUpdateAutonomy',
  'local-app.agentPresentationSnapshot',
  'local-app.agentCommitPresentation',
  'local-app.realmWorldCoreList',
  'local-app.realmWorldCoreCreate',
  'storage.readJson',
  'storage.writeJson',
  'storage.removeJson',
  'desktop-open.openIntent',
] as const;

describe('local-app public capability behavior', () => {
  it('projects the exact App Access declaration shell set', () => {
    const set = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find(
      (entry) => entry.setId === 'local-app-standard-shell-v1',
    );
    expect(set).toBeDefined();
    expect(set).toMatchObject({
      hostClass: 'protected-local-app-host',
      authBinding: 'runtime_owned_request_empty_local_app_session',
      authorityStatus: 'app_access_declarations_with_protected_operations_unavailable_until_admission',
      allowedOperations: FINAL_LOCAL_APP_OPERATIONS,
    });
    expect(set?.allowedCommands).toEqual(FINAL_LOCAL_APP_OPERATIONS.map(
      (operation) => NIMI_STANDARD_SHELL_COMMANDS[operation],
    ));
    expect(set?.allowedCommands.every((command) => typeof command === 'string' && command.length > 0)).toBe(true);
    expect(set?.plannedOperations).toEqual(expect.arrayContaining([
      'data.pathResolve',
      'config.get',
    ]));
  });

  it('keeps account, auth, lifecycle, OAuth, generic proxy, filesystem and desktop-private operations denied', () => {
    const set = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find(
      (entry) => entry.setId === 'local-app-standard-shell-v1',
    );
    expect(set?.forbiddenOperations).toEqual(expect.arrayContaining([
      'runtime.unary',
      'runtime.streamOpen',
      'runtime-lifecycle.status',
      'auth.sessionLoad',
      'oauth.tokenExchange',
      'platform-projection.get',
      'file-dialog.open',
      'desktop-private.product-control',
      'electron.raw-ipc',
      'node.raw-fs',
    ]));
    expect(new Set(set?.allowedOperations).size).toBe(FINAL_LOCAL_APP_OPERATIONS.length);
  });
});
