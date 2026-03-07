import { Runtime } from '../../../../src/runtime/index.js';
import { ExecutionMode, ScenarioType } from '../../../../src/runtime/generated/runtime/v1/ai.js';
import { VoiceReferenceKind } from '../../../../src/runtime/generated/runtime/v1/voice.js';
import { loadGoldFixture, loadGoldFixtureAudioInput } from '../../../../../scripts/ai-gold-path/fixtures.mjs';

function toTokenApiModelID(modelId: string): string {
  const normalized = String(modelId || '').trim();
  if (!normalized || normalized.startsWith('cloud/') || normalized.includes('/')) {
    return normalized;
  }
  return `cloud/${normalized}`;
}

function readArg(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function requireGoldSubjectUserId(): string {
  const value = String(process.env.NIMI_LIVE_GOLD_SUBJECT_USER_ID || '').trim();
  if (!value) {
    throw new Error('NIMI_LIVE_GOLD_SUBJECT_USER_ID_REQUIRED');
  }
  return value;
}

function trimPreview(value: string): string {
  const normalized = String(value || '').trim();
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}

function summarizeArtifacts(artifacts: Array<{ artifactId?: string; mimeType?: string; bytes?: Uint8Array }> | undefined): Record<string, unknown> {
  const safeArtifacts = Array.isArray(artifacts) ? artifacts : [];
  return {
    artifactCount: safeArtifacts.length,
    artifactIds: safeArtifacts.map((artifact) => String(artifact?.artifactId || '').trim()).filter(Boolean),
    mimeTypes: safeArtifacts.map((artifact) => String(artifact?.mimeType || '').trim()).filter(Boolean),
    totalBytes: safeArtifacts.reduce((total, artifact) => total + (artifact?.bytes instanceof Uint8Array ? artifact.bytes.length : 0), 0),
  };
}

function withFailure(base: Record<string, unknown>, error: unknown): Record<string, unknown> {
  const normalized = error as { traceId?: string; reasonCode?: string; actionHint?: string; message?: string };
  return {
    ...base,
    status: 'failed',
    traceId: String(normalized?.traceId || '').trim() || undefined,
    reasonCode: String(normalized?.reasonCode || '').trim() || undefined,
    actionHint: String(normalized?.actionHint || '').trim() || undefined,
    error: error instanceof Error ? error.message : String(error || ''),
  };
}

function toVoiceReference(fixture: ReturnType<typeof loadGoldFixture>) {
  const voiceRef = fixture.voice_ref;
  const voiceID = String(voiceRef?.id || '').trim();
  const voiceKind = String(voiceRef?.kind || '').trim().toLowerCase();
  if (!voiceID) {
    return undefined;
  }
  if (voiceKind === 'provider_voice_ref' || voiceKind === 'provider') {
    return {
      kind: VoiceReferenceKind.PROVIDER_VOICE_REF,
      reference: {
        oneofKind: 'providerVoiceRef' as const,
        providerVoiceRef: voiceID,
      },
    };
  }
  if (voiceKind === 'voice_asset_id' || voiceKind === 'voice_asset' || voiceKind === 'asset') {
    return {
      kind: VoiceReferenceKind.VOICE_ASSET,
      reference: {
        oneofKind: 'voiceAssetId' as const,
        voiceAssetId: voiceID,
      },
    };
  }
  return {
    kind: VoiceReferenceKind.PRESET,
    reference: {
      oneofKind: 'presetVoiceId' as const,
      presetVoiceId: voiceID,
    },
  };
}

async function submitAndCollect(runtime: Runtime, request: Record<string, unknown>): Promise<{
  traceId: string;
  jobId: string;
  modelResolved: string;
  summary: Record<string, unknown>;
  voiceAssetId?: string;
}> {
  const submitResponse = await runtime.ai.submitScenarioJob(request as never);
  const jobId = String(submitResponse.job?.jobId || '').trim();
  if (!jobId) {
    throw new Error('SDK_GOLD_JOB_ID_REQUIRED');
  }
  let traceId = String(submitResponse.job?.traceId || '').trim();
  let modelResolved = String(submitResponse.job?.modelResolved || '').trim();
  const voiceAssetId = String(submitResponse.asset?.voiceAssetId || '').trim() || undefined;

  const deadline = Date.now() + 180_000;
  for (;;) {
    const jobResponse = await runtime.ai.getScenarioJob({ jobId });
    const status = Number(jobResponse.job?.status || 0);
    if (!traceId) {
      traceId = String(jobResponse.job?.traceId || '').trim();
    }
    if (!modelResolved) {
      modelResolved = String(jobResponse.job?.modelResolved || '').trim();
    }
    if (status === 4) {
      const artifactsResponse = await runtime.ai.getScenarioArtifacts({ jobId });
      if (!traceId) {
        traceId = String(artifactsResponse.traceId || '').trim();
      }
      return {
        traceId,
        jobId,
        modelResolved,
        summary: summarizeArtifacts(artifactsResponse.artifacts as never),
        voiceAssetId,
      };
    }
    if (status === 5 || status === 6 || status === 7) {
      throw new Error(String(jobResponse.job?.reasonDetail || jobResponse.job?.reasonCode || 'SDK_GOLD_JOB_FAILED'));
    }
    if (Date.now() >= deadline) {
      throw new Error(`SDK_GOLD_JOB_TIMEOUT:${jobId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main(): Promise<void> {
  const endpoint = readArg('--endpoint');
  const fixturePath = readArg('--fixture');
  if (!endpoint) {
    throw new Error('SDK_GOLD_ENDPOINT_REQUIRED');
  }
  if (!fixturePath) {
    throw new Error('SDK_GOLD_FIXTURE_REQUIRED');
  }

  const fixture = loadGoldFixture(fixturePath);
  const fixtureAudio = loadGoldFixtureAudioInput(fixture);
  const runtimeModelId = toTokenApiModelID(fixture.model_id);
  const subjectUserId = requireGoldSubjectUserId();
  const runtime = new Runtime({
    appId: 'nimi.desktop.sdk.ai.gold',
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'sdk-ai-gold-path',
    },
    subjectContext: {
      subjectUserId,
    },
  });

  const base = {
    fixtureId: fixture.fixture_id,
    capability: fixture.capability,
    layer: 'L2_SDK_REPLAY',
    requestDigest: fixture.request_digest,
    resolvedProvider: fixture.provider,
    resolvedModel: fixture.model_id,
    resolvedTargetModel: fixture.target_model_id || undefined,
    routePolicy: 'token-api',
    fallbackPolicy: 'deny',
  };

  try {
    if (fixture.capability === 'text.generate') {
      const output = await runtime.ai.text.generate({
        model: runtimeModelId,
        input: String(fixture.request.prompt || '').trim(),
        system: String(fixture.request.system_prompt || '').trim() || undefined,
        route: 'token-api',
        fallback: 'deny',
      });
      process.stdout.write(`${JSON.stringify({
        ...base,
        status: 'passed',
        traceId: String(output.trace?.traceId || '').trim() || undefined,
        resolvedModel: String(output.trace?.modelResolved || fixture.model_id).trim(),
        artifactSummary: {
          textLength: String(output.text || '').trim().length,
          textPreview: trimPreview(String(output.text || '')),
          finishReason: output.finishReason,
        },
      }, null, 2)}\n`);
      return;
    }

    if (fixture.capability === 'text.embed') {
      const output = await runtime.ai.embedding.generate({
        model: runtimeModelId,
        input: Array.isArray(fixture.request.inputs) ? fixture.request.inputs : [],
        route: 'token-api',
        fallback: 'deny',
      });
      process.stdout.write(`${JSON.stringify({
        ...base,
        status: 'passed',
        traceId: String(output.trace?.traceId || '').trim() || undefined,
        resolvedModel: String(output.trace?.modelResolved || fixture.model_id).trim(),
        artifactSummary: {
          vectorCount: Array.isArray(output.vectors) ? output.vectors.length : 0,
        },
      }, null, 2)}\n`);
      return;
    }

    if (fixture.capability === 'image.generate') {
      const output = await runtime.media.image.generate({
        model: runtimeModelId,
        prompt: String(fixture.request.prompt || '').trim(),
        negativePrompt: String(fixture.request.negative_prompt || '').trim() || undefined,
        route: 'token-api',
        fallback: 'deny',
      });
      process.stdout.write(`${JSON.stringify({
        ...base,
        status: 'passed',
        traceId: String(output.trace?.traceId || '').trim() || undefined,
        resolvedModel: String(output.trace?.modelResolved || fixture.model_id).trim(),
        jobId: String(output.job?.jobId || '').trim() || undefined,
        artifactSummary: summarizeArtifacts(output.artifacts as never),
      }, null, 2)}\n`);
      return;
    }

    if (fixture.capability === 'audio.synthesize') {
      const collected = await submitAndCollect(runtime, {
        head: {
          appId: runtime.appId,
          modelId: runtimeModelId,
          routePolicy: 2,
          fallback: 1,
          timeoutMs: 180_000,
          connectorId: '',
        },
        scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
        executionMode: ExecutionMode.ASYNC_JOB,
        spec: {
          spec: {
            oneofKind: 'speechSynthesize',
            speechSynthesize: {
              text: String(fixture.request.text || '').trim(),
              language: String(fixture.request.language || '').trim(),
              audioFormat: String(fixture.request.audio_format || '').trim(),
              voiceRef: toVoiceReference(fixture),
            },
          },
        },
        extensions: [],
      });
      process.stdout.write(`${JSON.stringify({
        ...base,
        status: 'passed',
        traceId: collected.traceId || undefined,
        resolvedModel: collected.modelResolved || fixture.model_id,
        jobId: collected.jobId,
        artifactSummary: collected.summary,
      }, null, 2)}\n`);
      return;
    }

    if (fixture.capability === 'audio.transcribe') {
      const output = await runtime.media.stt.transcribe({
        model: runtimeModelId,
        audio: fixtureAudio?.kind === 'bytes'
          ? {
            kind: 'bytes',
            bytes: fixtureAudio.bytes,
          }
          : {
            kind: 'url',
            url: String(fixture.request.audio_uri || '').trim(),
          },
        mimeType: fixtureAudio?.mimeType || String(fixture.request.mime_type || '').trim() || undefined,
        language: String(fixture.request.language || '').trim() || undefined,
        route: 'token-api',
        fallback: 'deny',
      });
      process.stdout.write(`${JSON.stringify({
        ...base,
        status: 'passed',
        traceId: String(output.trace?.traceId || '').trim() || undefined,
        resolvedModel: String(output.trace?.modelResolved || fixture.model_id).trim(),
        jobId: String(output.job?.jobId || '').trim() || undefined,
        artifactSummary: {
          textLength: String(output.text || '').trim().length,
          textPreview: trimPreview(String(output.text || '')),
        },
      }, null, 2)}\n`);
      return;
    }

    const request = fixture.capability === 'voice.clone'
      ? {
        head: {
          appId: runtime.appId,
          modelId: runtimeModelId,
          routePolicy: 2,
          fallback: 1,
          timeoutMs: 180_000,
          connectorId: '',
        },
        scenarioType: ScenarioType.VOICE_CLONE,
        executionMode: ExecutionMode.ASYNC_JOB,
        spec: {
          spec: {
            oneofKind: 'voiceClone',
            voiceClone: {
              targetModelId: String(fixture.target_model_id || '').trim(),
              input: {
                ...(fixtureAudio?.kind === 'bytes'
                  ? {
                    referenceAudioBytes: fixtureAudio.bytes,
                    referenceAudioMime: fixtureAudio.mimeType,
                  }
                  : {
                    referenceAudioUri: String(fixture.request.audio_uri || '').trim(),
                  }),
              },
            },
          },
        },
        extensions: [],
      }
      : {
        head: {
          appId: runtime.appId,
          modelId: runtimeModelId,
          routePolicy: 2,
          fallback: 1,
          timeoutMs: 180_000,
          connectorId: '',
        },
        scenarioType: ScenarioType.VOICE_DESIGN,
        executionMode: ExecutionMode.ASYNC_JOB,
        spec: {
          spec: {
            oneofKind: 'voiceDesign',
            voiceDesign: {
              targetModelId: String(fixture.target_model_id || '').trim(),
              input: {
                instructionText: String(fixture.request.instruction_text || '').trim(),
              },
            },
          },
        },
        extensions: [],
      };

    const collected = await submitAndCollect(runtime, request);
    process.stdout.write(`${JSON.stringify({
      ...base,
      status: 'passed',
      traceId: collected.traceId || undefined,
      resolvedModel: collected.modelResolved || fixture.model_id,
      jobId: collected.jobId,
      artifactSummary: {
        ...collected.summary,
        ...(collected.voiceAssetId ? { voiceAssetId: collected.voiceAssetId } : {}),
      },
    }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(withFailure(base, error), null, 2)}\n`);
  }
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error || '');
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
});
