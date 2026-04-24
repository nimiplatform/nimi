import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  createMasterAgent,
  loadCreatorAgents,
} from '../src/runtime/data-sync/flows/agent-flow.js';

const socialFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/flows/social-flow.ts'),
  'utf8',
);
const profileFlowSocialSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/flows/profile-flow-social.ts'),
  'utf8',
);
const agentFlowSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/flows/agent-flow.ts'),
  'utf8',
);
const facadeActionsSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/data-sync/facade-actions.ts'),
  'utf8',
);

test('agent flow behaviorally owns CreatorService list and create calls', async () => {
  const capturedCalls: string[] = [];
  const callApi = async <T>(task: (realm: unknown) => Promise<T>): Promise<T> =>
    task({
      services: {
        CreatorService: {
          creatorControllerListAgents: async () => {
            capturedCalls.push('list-agents');
            return [{ id: 'agent-1', displayName: 'Agent One' }];
          },
          creatorControllerCreateAgent: async (input: Record<string, unknown>) => {
            capturedCalls.push(`create-agent:${String(input.handle || '')}`);
            return { id: 'agent-2', ...input };
          },
        },
      },
    });

  const agents = await loadCreatorAgents(callApi as never);
  const created = await createMasterAgent(callApi as never, {
    worldId: 'world-1',
    handle: ' agent_two ',
    concept: ' concept ',
    displayName: ' Agent Two ',
  });

  assert.deepEqual(capturedCalls, ['list-agents', 'create-agent:agent_two']);
  assert.deepEqual(agents, [{ id: 'agent-1', displayName: 'Agent One' }]);
  assert.equal(created.id, 'agent-2');
  assert.equal(created.handle, 'agent_two');
  assert.equal(created.concept, 'concept');
});

test('creator-agent permission failures fail closed instead of returning []', async () => {
  await assert.rejects(
    () => loadCreatorAgents((async () => {
      throw new Error('Forbidden');
    }) as never),
    /Forbidden/,
  );
});

test('contacts social flow no longer owns CreatorService operations', () => {
  assert.doesNotMatch(socialFlowSource, /CreatorService/);
  assert.doesNotMatch(socialFlowSource, /creatorControllerCreateAgent/);
  assert.doesNotMatch(socialFlowSource, /creatorControllerListAgents/);
  assert.doesNotMatch(profileFlowSocialSource, /loadCreatorAgents/);
  assert.doesNotMatch(profileFlowSocialSource, /CreatorService/);
});

test('agent flow does not keep contacts-local denied pseudo-success state', () => {
  assert.match(agentFlowSource, /CreatorService\.creatorControllerListAgents/);
  assert.match(agentFlowSource, /CreatorService\.creatorControllerCreateAgent/);
  assert.doesNotMatch(agentFlowSource, /sessionStorage/);
  assert.doesNotMatch(agentFlowSource, /nimi\.data-sync\.creator-agents\.denied/);
  assert.doesNotMatch(agentFlowSource, /Developer access required[\s\S]*return \[\]/);
  assert.doesNotMatch(agentFlowSource, /Forbidden[\s\S]*return \[\]/);
});

test('facade actions route creator-agent methods through agent-flow', () => {
  assert.match(
    facadeActionsSource,
    /from '\.\/flows\/agent-flow';/,
  );
  assert.doesNotMatch(
    facadeActionsSource,
    /import \{[^}]*createMasterAgent[^}]*\} from '\.\/flows\/social-flow';/,
  );
});
