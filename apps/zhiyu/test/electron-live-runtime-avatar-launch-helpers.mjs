import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  AgentPresentationBackendKind,
} from '../../../sdks/typescript/core-generated/runtime-typed-client.ts';
import {
  buildRuntimeAgentRequestContext,
} from '../../../sdks/typescript/runtime/agent-local-identity.ts';
import {
  Runtime,
  createNimiRuntimeAppSessionMetadataProvider,
  withNimiRuntimeAgentScopes,
} from '../../../sdks/typescript/runtime/index.ts';
import {
  captureLiveRuntimeEvidence,
} from './electron-live-runtime-acceptance-helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const desktopAppId = 'nimi.desktop';
const zhiyuAppId = 'nimi.zhiyu';
export const avatarAppId = 'nimi.avatar';
const zhiyuRuntimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'ai.spend.meter',
];
export const avatarRuntimeProtectedScopes = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.avatar_debug.read',
  'runtime.agent.avatar_debug.write',
];

export async function seedLiveRuntimeAvatarPresentationProfile(fixture) {
  await fixture.runtime.agents.setAgentPresentationProfile(
    {
      context: buildLiveRuntimeAgentRequestContext(fixture, desktopAppId),
      agentId: fixture.localAgentRef,
      mutation: {
        oneofKind: 'profile',
        profile: {
          backendKind: AgentPresentationBackendKind.VRM,
          avatarAssetRef: 'runtime-presentation-avatar:zhiyu-live-vrm-fixture',
          expressionProfileRef: 'expression://runtime-live/calm',
          idlePreset: 'idle-soft',
          interactionPolicyRef: 'policy://runtime-live/ambient',
          defaultVoiceReference: 'preset_voice_id:runtime-live-voice',
        },
      },
    },
    {
      metadata: {
        idempotencyKey: `zhiyu-live-runtime-avatar-presentation:${fixture.localAgentRef}`,
        'x-nimi-idempotency-key': `zhiyu-live-runtime-avatar-presentation:${fixture.localAgentRef}`,
      },
    },
  );
}

export async function importLiveRuntimeAvatarFixtureAsset(page, evidence) {
  const sourcePath = path.resolve(root, '..', 'avatar', 'fixtures', 'vrm-debug', 'VRM1_Constraint_Twist_Sample.vrm');
  await page.waitForFunction(() => Boolean(globalThis.window?.__nimiZhiyuAgentCenterLocalConfig));
  const result = await page.evaluate(async ({ sourcePath: fixtureSourcePath, scope }) => {
    return globalThis.window.__nimiZhiyuAgentCenterLocalConfig.invoke('avatar.import', {
      ...scope,
      kind: 'vrm',
      sourcePath: fixtureSourcePath,
      select: true,
    });
  }, {
    sourcePath,
    scope: {
      accountId: evidence.auth.accountId,
      ownerUserId: evidence.conversation.ownerUserId,
      runtimeSourceRef: evidence.conversation.runtimeSourceRef,
      localAgentRef: evidence.conversation.localAgentRef,
    },
  });
  assert.equal(result?.backend_kind, 'vrm');
  assert.match(result?.local_asset_id ?? '', /^vrm_[a-f0-9]{12}$/u);
  assert.equal(result?.selected, true);
  assert.equal(result?.validation?.status, 'valid');
  return {
    sourcePath,
    local_asset_id: result.local_asset_id,
    backend_kind: result.backend_kind,
    materialization_ref: result.materialization_ref,
    backend_capability_profile_ref: result.backend_capability_profile_ref,
    validation: result.validation,
  };
}

export async function assertAvatarLaunchLiveHandoff(page, fixture, dataRoot, pageProblems, readyEvidence, importedAvatarAsset) {
  let launchPid = null;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-zhiyu-composer-tool="agent"]').click();
  await page.locator('[data-zhiyu-agent-center-tab-button="appearance"]').click();
  try {
    const panel = page.locator('[data-zhiyu-agent-appearance-panel="true"]');
    await panel.waitFor({ timeout: 15_000 });
    const launchCard = panel.locator('[data-zhiyu-avatar-launch-card="ready"]').first();
    await launchCard.waitFor({ timeout: 15_000 });
    assert.equal(await launchCard.getAttribute('data-zhiyu-avatar-launch-reason'), 'zhiyu-avatar-launch-ready');
    const launchButton = launchCard.locator('[data-zhiyu-avatar-launch-action="launch"]').first();
    await launchButton.waitFor({ timeout: 15_000 });
    assert.equal(await launchButton.isDisabled(), false);
    await launchButton.click();

    await waitForEvidence(page, () =>
      globalThis.window.__nimiZhiyuEvidence?.avatar?.reasonCode === 'zhiyu-avatar-launch-requested'
      && globalThis.window.__nimiZhiyuEvidence?.avatar?.launchHandoff?.opened === true
      && Boolean(globalThis.window.__nimiZhiyuEvidence?.avatar?.launchHandoff?.avatarInstanceId),
      'Avatar launch handoff requested through Zhiyu Electron host',
    );
    const zhiyuEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
    const launchResult = zhiyuEvidence.avatar.launchHandoff;
    launchPid = launchResult.pid;
    const avatarInstanceId = launchResult.avatarInstanceId;
    assert.equal(launchResult.opened, true);
    assert.equal(launchResult.launchSource, 'zhiyu');
    assert.match(avatarInstanceId, /^zhiyu-avatar-/u);
    assert.doesNotMatch(avatarInstanceId, /agent_anchor_|conversation-anchor|must-stay-in-runtime/u);

    const resolvedBinding = await resolveAvatarLiveInstanceBindingForZhiyuTest(fixture, avatarInstanceId);
    assert.equal(resolvedBinding.binding.avatarInstanceId, avatarInstanceId);
    assert.equal(resolvedBinding.binding.ownerUserId, fixture.ownerUserId);
    assert.equal(resolvedBinding.binding.runtimeSourceRef, fixture.runtimeSourceRef);
    assert.equal(resolvedBinding.binding.localAgentRef, fixture.localAgentRef);
    assert.equal(resolvedBinding.binding.conversationAnchorId, readyEvidence.conversation.conversationAnchorId);
    assert.equal(resolvedBinding.snapshot.anchor?.conversationAnchorId, readyEvidence.conversation.conversationAnchorId);

    const avatarEvidenceRecords = await waitForAvatarEvidenceRecords({
      dataRoot,
      avatarInstanceId,
      requiredKinds: [
        'avatar.startup.runtime-bound',
        'avatar.visual.local-asset-resolved',
      ],
    });
    const runtimeBoundEvidence = requiredAvatarEvidenceRecord(avatarEvidenceRecords, 'avatar.startup.runtime-bound');
    const localAssetEvidence = requiredAvatarEvidenceRecord(avatarEvidenceRecords, 'avatar.visual.local-asset-resolved');
    assertAvatarEvidenceMatchesLaunch({
      record: runtimeBoundEvidence,
      avatarInstanceId,
      conversationAnchorId: readyEvidence.conversation.conversationAnchorId,
    });
    assertAvatarEvidenceMatchesLaunch({
      record: localAssetEvidence,
      avatarInstanceId,
      conversationAnchorId: readyEvidence.conversation.conversationAnchorId,
    });
    assert.equal(localAssetEvidence.detail?.backend_kind, importedAvatarAsset.backend_kind);
    assert.equal(localAssetEvidence.detail?.local_asset_ref, importedAvatarAsset.local_asset_id);

    await captureLiveRuntimeEvidence(page, 'avatarLaunch', pageProblems, {
      readyEvidence,
      zhiyuAvatarLaunchEvidence: zhiyuEvidence.avatar,
      resolvedAvatarBinding: resolvedBinding.binding,
      avatarElectronEvidence: runtimeBoundEvidence,
      avatarElectronEvidenceRecords: avatarEvidenceRecords,
    });
    return {
      zhiyuAvatarLaunchEvidence: zhiyuEvidence.avatar,
      resolvedAvatarBinding: resolvedBinding.binding,
      avatarElectronEvidence: runtimeBoundEvidence,
      avatarElectronEvidenceRecords: avatarEvidenceRecords,
    };
  } finally {
    await closeSpawnedAvatarProcess(launchPid);
    await page.locator('[data-zhiyu-agent-panel-close="true"]').click().catch(() => {});
    await page.locator('[data-zhiyu-region="agent-panel"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  }
}

function buildLiveRuntimeAgentRequestContext(fixture, runtimeAppId) {
  return buildRuntimeAgentRequestContext({
    runtimeAppId,
    subjectUserId: fixture.ownerUserId,
    ownerUserId: fixture.ownerUserId,
    runtimeSourceRef: fixture.runtimeSourceRef,
    localAgentRef: fixture.localAgentRef,
  });
}

function requiredAvatarEvidenceRecord(records, kind) {
  const record = records.find((candidate) => candidate.kind === kind);
  assert.ok(record, `Avatar Electron evidence missing ${kind}`);
  return record;
}

async function resolveAvatarLiveInstanceBindingForZhiyuTest(fixture, avatarInstanceId) {
  const runtime = new Runtime({
    appId: zhiyuAppId,
    transport: {
      type: 'node-grpc',
      endpoint: fixture.endpoint,
    },
  });
  const appSessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: zhiyuAppId,
    appInstanceId: `${zhiyuAppId}.platform-runtime-session`,
    deviceId: 'zhiyu-platform-runtime-session',
    capabilities: zhiyuRuntimeProtectedScopes,
    developerRegistration: false,
    auth: runtime.auth,
  });
  return withNimiRuntimeAgentScopes({
    runtime: {
      appId: zhiyuAppId,
      auth: runtime.auth,
      appAuth: runtime.grants,
    },
    subjectUserId: fixture.ownerUserId,
  }, ['runtime.agent.read'], async (options) => {
    const sessionMetadata = await appSessionMetadata();
    return runtime.agents.resolveAvatarLiveInstanceBinding({
      context: buildLiveRuntimeAgentRequestContext(fixture, zhiyuAppId),
      avatarInstanceId,
    }, {
      ...options,
      metadata: {
        ...sessionMetadata,
        ...(options.metadata ?? {}),
        idempotencyKey: `zhiyu-live-runtime-avatar-binding:${avatarInstanceId}`,
        'x-nimi-idempotency-key': `zhiyu-live-runtime-avatar-binding:${avatarInstanceId}`,
      },
    });
  });
}

function assertAvatarEvidenceMatchesLaunch(input) {
  const detail = input.record.detail ?? {};
  const consume = input.record.consume ?? {};
  assert.equal(detail.avatar_instance_id ?? consume.avatarInstanceId, input.avatarInstanceId);
  const evidenceConversationAnchorId = detail.conversation_anchor_id ?? consume.conversationAnchorId;
  if (evidenceConversationAnchorId) {
    assert.equal(evidenceConversationAnchorId, input.conversationAnchorId);
  }
}

async function waitForAvatarEvidenceRecords(input) {
  const evidencePath = path.join(
    input.dataRoot,
    'avatar-launches',
    safePathSegment(input.avatarInstanceId),
    'evidence',
    'avatar-electron-evidence.jsonl',
  );
  const deadline = Date.now() + 60_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const records = await readAvatarEvidenceRecords(evidencePath);
      const bindFailed = records.find((candidate) => candidate.kind === 'avatar.runtime.bind-failed');
      if (bindFailed) {
        const detail = bindFailed.detail ?? {};
        assert.notEqual(detail.error_stage, 'account_session_status');
        assert.notEqual(detail.error_stage, 'account_access_token');
        assert.notEqual(detail.error_stage, 'conversation_context');
        throw new Error(`Avatar Electron bind failed: ${JSON.stringify(detail)}`);
      }
      const missingKinds = input.requiredKinds.filter((kind) => !records.some((record) => record.kind === kind));
      if (missingKinds.length === 0) {
        return records;
      }
      lastError = `missing=${missingKinds.join(',')}; records=${records.map((record) => record.kind).join(',')}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Avatar Electron evidence did not contain required ${input.requiredKinds.join(', ')} at ${evidencePath}: ${lastError}`);
}

async function readAvatarEvidenceRecords(evidencePath) {
  const text = await readFile(evidencePath, 'utf8');
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function closeSpawnedAvatarProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return;
  }
  if (process.platform === 'win32') {
    const { execFile } = await import('node:child_process');
    await new Promise((resolve) => {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], () => resolve(undefined));
    });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // The Avatar shell may already have closed after recording fail-closed evidence.
  }
}

function safePathSegment(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'avatar';
}

async function waitForEvidence(page, predicate, label, argument) {
  try {
    await page.waitForFunction(predicate, argument, { timeout: 45_000 });
  } catch (error) {
    const evidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence).catch((evalError) => ({
      evaluationError: evalError instanceof Error ? evalError.message : String(evalError),
    }));
    throw new Error(`${label} timed out: ${JSON.stringify({ evidence })}`, { cause: error });
  }
}
