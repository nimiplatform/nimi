import assert from 'node:assert/strict';
import test from 'node:test';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import { ExecutionMode, ScenarioJobStatus, ScenarioType } from '@nimiplatform/sdk/runtime';
import { runDesktopBridgeReplay } from '../src/runtime/llm-adapter/execution/replay.js';

test('desktop replay voice design uses async-job enum values without injecting subjectUserId', async () => {
  let capturedRequest: Record<string, unknown> | null = null;
  let capturedOptions: Record<string, unknown> | null = null;

  const runtime = {
    appId: 'nimi.desktop.ai.gold',
    ai: {
      submitScenarioJob: async (request: Record<string, unknown>, options?: Record<string, unknown>) => {
        capturedRequest = request;
        capturedOptions = options || null;
        return {
          job: {
            jobId: 'job-voice-design',
            traceId: 'trace-voice-design',
            modelResolved: 'cloud/qwen3-tts-vd',
          },
          asset: {
            voiceAssetId: 'voice-asset-1',
          },
        };
      },
      getScenarioJob: async () => ({
        job: {
          status: ScenarioJobStatus.COMPLETED,
          traceId: 'trace-voice-design',
          modelResolved: 'cloud/qwen3-tts-vd',
        },
      }),
      getScenarioArtifacts: async () => ({
        traceId: 'trace-voice-design',
        artifacts: [],
      }),
    },
  } as unknown as Runtime;

  const result = await runDesktopBridgeReplay({
    runtime,
    fixture: {
      fixture_id: 'dashscope.voice.design',
      capability: 'voice.design',
      provider: 'dashscope',
      model_id: 'qwen3-tts-vd',
      target_model_id: 'qwen3-tts-vd-2026-01-26',
      request: {
        instruction_text: 'warm female narrator',
      },
      request_digest: 'fixture-digest-voice-design',
    },
  });

  assert.equal(result.status, 'passed');
  assert.ok(capturedRequest);
  const request = capturedRequest as Record<string, unknown>;
  assert.equal(request.scenarioType, ScenarioType.VOICE_DESIGN);
  assert.equal(request.executionMode, ExecutionMode.ASYNC_JOB);

  const head = (request.head || {}) as Record<string, unknown>;
  assert.equal(head.subjectUserId, undefined);

  const options = (capturedOptions || {}) as Record<string, unknown>;
  const metadata = ((options.metadata || {}) as Record<string, unknown>);
  assert.equal(metadata.callerKind, 'desktop-core');
  assert.equal(metadata.callerId, 'core.desktop.ai-gold-path');
  assert.equal(metadata.surfaceId, 'desktop.renderer');
});
