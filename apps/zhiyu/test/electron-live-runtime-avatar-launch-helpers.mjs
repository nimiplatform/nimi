import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  buildRuntimeAgentRequestContext,
} from '../../../sdks/typescript/runtime/agent-local-identity.ts';
import {
  Runtime,
  createNimiRuntimeAppSessionMetadataProvider,
  withNimiRuntimeAgentScopes,
} from '../../../sdks/typescript/runtime/index.ts';
import {
  createNimiHostRuntimeAgentPresentationProfileSurface,
} from '../../../sdks/typescript/runtime/runtime-agent-presentation.ts';
import { NIMI_STANDARD_SHELL_COMMANDS } from '../../../kit/shell/capabilities/src/index.ts';
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
  const identity = {
    ownerUserId: fixture.ownerUserId,
    runtimeSourceRef: fixture.runtimeSourceRef,
    localAgentRef: fixture.localAgentRef,
  };
  const presentation = createNimiHostRuntimeAgentPresentationProfileSurface({
    getRuntime: () => ({
      appId: desktopAppId,
      auth: fixture.runtime.auth,
      appAuth: fixture.runtime.grants,
      agent: fixture.runtime.agents,
    }),
    getSubjectUserId: () => fixture.ownerUserId,
    withScopes: (scopes, operation) => withNimiRuntimeAgentScopes({
      runtime: {
        appId: desktopAppId,
        auth: fixture.runtime.auth,
        appAuth: fixture.runtime.grants,
      },
      subjectUserId: fixture.ownerUserId,
    }, scopes, async (options) => {
      const sessionMetadata = await createNimiRuntimeAppSessionMetadataProvider({
        appId: desktopAppId,
        appInstanceId: `${desktopAppId}.local-first-party`,
        deviceId: 'desktop-shell',
        capabilities: ['runtime.agent.write'],
        auth: fixture.runtime.auth,
      })();
      const idempotencyKey = `zhiyu-live-runtime-avatar-presentation:${fixture.localAgentRef}`;
      return operation({
        ...options,
        metadata: {
          ...sessionMetadata,
          ...(options.metadata ?? {}),
          idempotencyKey,
          'x-nimi-idempotency-key': idempotencyKey,
        },
      });
    }),
  });
  const current = await fixture.agentPresentation.getPresentationProfile(identity);
  await presentation.setPresentationProfile(identity, {
    backendKind: 'vrm',
    avatarAssetRef: 'runtime-presentation-avatar:zhiyu-live-vrm-fixture',
    expressionProfileRef: 'runtime-expression-profile:zhiyu-live-calm',
    idlePreset: 'runtime-idle-preset:idle-soft',
    interactionPolicyRef: 'runtime-interaction-policy:zhiyu-live-ambient',
    defaultVoiceReference: 'preset_voice_id:runtime-live-voice',
    avatarAutoplay: true,
  }, current.committedRevision);
}

export async function importLiveRuntimeAvatarFixtureAsset(page, evidence) {
  const sourcePath = path.resolve(root, '..', 'avatar', 'fixtures', 'vrm-debug', 'VRM1_Constraint_Twist_Sample.vrm');
  await page.waitForFunction(() => Boolean(globalThis.window?.__NIMI_ELECTRON_RUNTIME__));
  const result = await page.evaluate(async ({ commands, importScope }) => {
    const dialogResult = await globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commands.fileDialogOpen, {
      kind: 'file',
      title: 'Select VRM file',
      filters: [{ name: 'VRM', extensions: ['vrm'] }],
    });
    if (dialogResult.canceled || dialogResult.paths.length !== 1) {
      throw new Error('VRM fixture file dialog did not return exactly one path.');
    }
    return globalThis.window.__NIMI_ELECTRON_RUNTIME__.invoke(commands.avatarAssetImport, {
      hostScope: 'local-agent',
      accountId: importScope.accountId,
      localAgentRef: importScope.localAgentRef,
      backendKind: 'vrm',
      sourcePath: dialogResult.paths[0],
    });
  }, {
    importScope: {
      accountId: evidence.auth.accountId,
      localAgentRef: evidence.conversation.localAgentRef,
    },
    commands: {
      fileDialogOpen: NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open'],
      avatarAssetImport: NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport'],
    },
  });
  assert.equal(result?.backendKind, 'vrm');
  assert.match(result?.avatarAssetRef ?? '', /^vrm_[a-f0-9]{12}$/u);
  assert.equal(result?.validationStatus, 'valid');
  return {
    sourcePath,
    avatarAssetRef: result.avatarAssetRef,
    backendKind: result.backendKind,
    backendCapabilityProfileRef: result.backendCapabilityProfileRef,
    validationStatus: result.validationStatus,
  };
}

export async function assertAvatarLaunchLiveHandoff(
  page,
  fixture,
  dataRoot,
  pageProblems,
  readyEvidence,
  importedAvatarAsset,
  options = {},
) {
  let launchPid = null;
  let handoffSucceeded = false;
  let avatarProcessClosed = false;
  const closeAvatarProcess = async () => {
    if (avatarProcessClosed) {
      return;
    }
    avatarProcessClosed = true;
    await closeSpawnedAvatarProcess(launchPid);
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  try {
    const launchEntry = page.locator('[data-zhiyu-avatar-launch-entry="ready"]').first();
    await launchEntry.waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await launchEntry.getAttribute('data-zhiyu-avatar-launch-reason'), 'zhiyu-avatar-launch-ready');
    assert.equal(await launchEntry.isDisabled(), false);
    await launchEntry.click();

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
      launchPid,
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
    assert.equal(localAssetEvidence.detail?.backend_kind, importedAvatarAsset.backendKind);
    assert.equal(localAssetEvidence.detail?.local_asset_ref, importedAvatarAsset.avatarAssetRef);

    await page.locator('[data-zhiyu-composer-tool="agent"]').click();
    await page.locator('[data-testid="chat-agent-center-section:appearance"]').click();
    const kitAppearancePanel = page.locator('[data-zhiyu-agent-center-kit-surface="true"]').first();
    await kitAppearancePanel.waitFor({ timeout: 15_000 });
    await kitAppearancePanel.locator('#agent-center-appearance-title').waitFor({ timeout: 15_000 });
    assert.equal(await kitAppearancePanel.locator('[data-zhiyu-avatar-launch-card]').count(), 0, 'avatar launch controls must stay outside Kit Agent Center appearance projection');
    await page.locator('[data-testid="chat-agent-center-section:overview"]').click();
    await page.locator('#agent-center-overview-title').waitFor({ timeout: 15_000 });

    await captureLiveRuntimeEvidence(page, 'avatarLaunch', pageProblems, {
      readyEvidence,
      zhiyuAvatarLaunchEvidence: zhiyuEvidence.avatar,
      resolvedAvatarBinding: resolvedBinding.binding,
      avatarElectronEvidence: runtimeBoundEvidence,
      avatarElectronEvidenceRecords: avatarEvidenceRecords,
    });
    handoffSucceeded = true;
    return {
      zhiyuAvatarLaunchEvidence: zhiyuEvidence.avatar,
      resolvedAvatarBinding: resolvedBinding.binding,
      avatarElectronEvidence: runtimeBoundEvidence,
      avatarElectronEvidenceRecords: avatarEvidenceRecords,
      closeAvatarProcess,
    };
  } finally {
    if (options.keepRunning !== true || !handoffSucceeded) {
      await closeAvatarProcess();
    }
    await page.locator('[data-zhiyu-agent-panel-close="true"]').click().catch(() => {});
    await page.locator('[data-zhiyu-region="agent-panel"]').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
  }
}

export async function waitForAvatarNativeVoiceChunkPlaybackEvidence(input) {
  const evidencePath = path.join(
    input.dataRoot,
    'avatar-launches',
    safePathSegment(input.avatarInstanceId),
    'evidence',
    'avatar-electron-evidence.jsonl',
  );
  const deadline = Date.now() + 90_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const records = await readAvatarEvidenceRecords(evidencePath);
      const matched = records.find((record) =>
        record.kind === 'avatar.audio.native_stream_chunk_played'
        && record.detail?.voice_stream_id === input.voiceStreamId
        && record.detail?.playback_state === 'completed'
        && Number(record.detail?.chunk_sequence ?? 0) > 0
        && Number(record.detail?.byte_length ?? 0) > 0
      );
      if (matched) {
        return matched;
      }
      const failed = records.filter((record) =>
        (record.kind === 'avatar.audio.native_stream_chunk_failed'
          || record.kind === 'avatar.audio.native_stream_subscription_failed')
        && record.detail?.voice_stream_id === input.voiceStreamId
      );
      const projections = records.filter((record) =>
        record.kind === 'avatar.audio.native_stream_projection_received'
        && record.detail?.voice_stream_id === input.voiceStreamId
      );
      lastError = `missing avatar.audio.native_stream_chunk_played for ${input.voiceStreamId}; projections=${JSON.stringify(projections.map((record) => record.detail))}; failures=${JSON.stringify(failed.map((record) => record.detail))}; records=${records.map((record) => record.kind).join(',')}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Avatar Electron evidence did not contain native voice playback for ${input.voiceStreamId} at ${evidencePath}: ${lastError}`);
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
    appId: desktopAppId,
    transport: {
      type: 'node-grpc',
      endpoint: fixture.endpoint,
    },
  });
  const appSessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: desktopAppId,
    appInstanceId: `${desktopAppId}.live-runtime-avatar-binding`,
    deviceId: 'nimi-desktop-live-runtime-avatar-binding-device',
    capabilities: ['runtime.agent.read'],
    auth: runtime.auth,
  });
  return withNimiRuntimeAgentScopes({
    runtime: {
      appId: desktopAppId,
      auth: runtime.auth,
      appAuth: runtime.grants,
    },
    subjectUserId: fixture.ownerUserId,
  }, ['runtime.agent.read'], async (options) => {
    const sessionMetadata = await appSessionMetadata();
    return runtime.agents.resolveAvatarLiveInstanceBinding({
      context: buildLiveRuntimeAgentRequestContext(fixture, desktopAppId),
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
    if (Number.isSafeInteger(input.launchPid) && input.launchPid > 0 && !processIsAlive(input.launchPid)) {
      lastError = `avatar process ${input.launchPid} exited before evidence was written; ${lastError}`;
      break;
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

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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
