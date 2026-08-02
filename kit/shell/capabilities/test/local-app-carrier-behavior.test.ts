import { describe, expect, it } from 'vitest';

import {
  NIMI_STANDARD_SHELL_CAPABILITY_SETS,
  NIMI_STANDARD_SHELL_COMMANDS,
} from '../src/index.js';

const FINAL_LOCAL_APP_OPERATIONS = [
  'local-app.sessionStatus',
  'local-app.permissionStatus',
  'local-app.permissionRequest',
  'local-app.textGenerateCandidate',
  'local-app.conversationOpen',
  'local-app.conversationSendTurn',
  'local-app.conversationInterruptTurn',
  'local-app.conversationSubscribe',
  'local-app.conversationSnapshot',
  'local-app.artifactPut',
  'local-app.artifactReadBytes',
  'local-app.agentConfigurationSnapshot',
  'local-app.agentUpdateConfiguration',
  'local-app.agentReadinessSnapshot',
  'local-app.agentAIProfilePreview',
  'local-app.agentAIProfileApply',
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
  it('projects the exact base-entitlement and product-permission shell set', () => {
    const set = NIMI_STANDARD_SHELL_CAPABILITY_SETS.find(
      (entry) => entry.setId === 'local-app-standard-shell-v1',
    );
    expect(set).toBeDefined();
    expect(set).toMatchObject({
      hostClass: 'protected-local-app-host',
      authBinding: 'runtime_owned_request_empty_local_app_session',
      authorityStatus: 'permission_model_v1_with_exact_admitted_operation_families',
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
