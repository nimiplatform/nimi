// Runtime Artifacts module — generic by-id artifact bytes retrieval.
//
// Authority: S-RUNTIME-111 (.nimi/spec/sdk/kernel/runtime-contract.md)
// Underlying contract: K-AGCORE-053 (.nimi/spec/runtime/kernel/runtime-artifact-contract.md)
// Proto: proto/runtime/v1/artifact_service.proto (RuntimeArtifactService.ReadArtifactBytes)
//
// Use cases:
//   - avatar app reads voice_playback_requested.audio_artifact_id bytes for
//     wLipSync analysis + AudioContext decode + speaker output.
//   - future image/video/music consumers read by id without depending on
//     ScenarioJob (artifacts may originate from realtime, cache, streaming
//     TTS, local voice engine, or user upload).
//
// Orthogonal to:
//   - runtime.media.* typed projections (S-RUNTIME-073 via getScenarioArtifacts)
//   - runtime voice asset library (getVoiceAsset)

import type { RuntimeInternalContext } from './internal-context.js';
import type { RuntimeCallOptions } from './types.js';
import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';

export interface RuntimeArtifactsReadBytesInput {
  /** Runtime-owned artifact identity (e.g. voice_playback_requested.audio_artifact_id). Required. */
  artifactId: string;
  /**
   * Optional RFC-6838 top-level type prefix (e.g. 'audio/', 'image/',
   * 'video/'). When provided, SDK fail-closes ARTIFACT_MIME_MISMATCH if
   * runtime returns a mime_type not starting with this prefix
   * (case-insensitive). Note: 'music/' is NOT a valid RFC-6838 top-level
   * type — music artifacts use 'audio/*' (e.g. audio/mpeg, audio/aac).
   */
  expectedMimePrefix?: 'audio/' | 'image/' | 'video/' | 'text/' | 'application/' | string;
}

export interface RuntimeArtifactsReadBytesResult {
  /** Full artifact body. Inline-capped at 32 MiB by the runtime contract. */
  bytes: ArrayBuffer;
  /** RFC-6838 media type. Always present (server fills inferred mime if missing). */
  mimeType: string;
  /** Total artifact size in bytes. */
  sizeBytes: number;
  /** True if mime_type was runtime-inferred rather than provider-declared. */
  mimeInferred: boolean;
}

export interface RuntimeArtifactsModule {
  /**
   * Read artifact bytes by runtime-owned artifact_id.
   *
   * Throws NimiError with stable reason codes:
   *   - SDK_INVALID_INPUT: empty/non-string artifactId
   *   - ARTIFACT_NOT_FOUND: id missing in runtime storage (gc / never created)
   *   - ARTIFACT_TOO_LARGE: exceeds 32 MiB inline cap
   *   - ARTIFACT_FORBIDDEN: multi-tenant ACL violation (reserved; current
   *     single-runtime deployment never returns this)
   *   - ARTIFACT_MIME_MISMATCH: client expectedMimePrefix not satisfied by
   *     server-returned mime_type (SDK-side check)
   *
   * Never returns empty bytes / default mime / pretend-success on failure.
   * Per S-RUNTIME-111 fail-close posture. No fallback / retry knobs.
   */
  readBytes(
    input: RuntimeArtifactsReadBytesInput,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeArtifactsReadBytesResult>;
}

/**
 * Construct the RuntimeArtifactsModule with the Runtime class internal context.
 * Called from Runtime constructor (per S-RUNTIME-111: Runtime class
 * `readonly artifacts` field, NOT a singleton const export).
 */
export function createRuntimeArtifactsModule(input: {
  ctx: RuntimeInternalContext;
}): RuntimeArtifactsModule {
  const { ctx } = input;
  return {
    async readBytes(req, optionsValue) {
      const artifactId = typeof req.artifactId === 'string' ? req.artifactId.trim() : '';
      if (!artifactId) {
        throw createNimiError({
          message: 'runtime.artifacts.readBytes requires non-empty artifactId',
          reasonCode: ReasonCode.ARTIFACT_INVALID_INPUT,
          actionHint: 'pass_runtime_emitted_artifact_id',
          source: 'sdk',
        });
      }

      const response = await ctx.invokeWithClient(async (client) =>
        client.artifact.readArtifactBytes({ artifactId }, optionsValue),
      );

      if (req.expectedMimePrefix) {
        const prefix = req.expectedMimePrefix.toLowerCase();
        if (!response.mimeType.toLowerCase().startsWith(prefix)) {
          throw createNimiError({
            message: `runtime artifact mime "${response.mimeType}" does not match expected prefix "${prefix}"`,
            reasonCode: ReasonCode.ARTIFACT_MIME_MISMATCH,
            actionHint: 'verify_runtime_provider_mime_type',
            source: 'runtime',
          });
        }
      }

      return {
        bytes: response.bytes.buffer.slice(
          response.bytes.byteOffset,
          response.bytes.byteOffset + response.bytes.byteLength,
        ) as ArrayBuffer,
        mimeType: response.mimeType,
        sizeBytes: Number(response.sizeBytes),
        mimeInferred: response.mimeInferred,
      };
    },
  };
}
