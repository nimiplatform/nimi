import { isJsonObject } from '@nimiplatform/sdk/types';

import type { AIStudioHistoryPanelPreferences } from './workspace.js';
import type { StudioRunHistory, StudioRunHistoryRecord } from './history.js';

export const STUDIO_HISTORY_LIMIT_PER_CAPABILITY = 40;
export const STUDIO_HISTORY_LIMIT_TOTAL_RECORDS = 160;
export const STUDIO_HISTORY_LIMIT_BYTES = 240 * 1024;
// One long input must not push every other capability out of the shared budget.
export const STUDIO_HISTORY_INPUT_LIMIT_BYTES = 16 * 1024;

export const DEFAULT_AI_STUDIO_HISTORY_PANEL_PREFERENCES: AIStudioHistoryPanelPreferences = Object.freeze({
  collapsed: true,
  scope: 'capability',
  hideFailures: false,
});

function historyError(path: string, detail: string): never {
  throw new Error(`AI Studio history payload ${detail} at ${path}.`);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string') return historyError(path, 'requires a string');
  return value;
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') historyError(path, 'requires a string when present');
}

function nonNegativeNumber(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    historyError(path, 'requires a non-negative finite number');
  }
}

function optionalNonNegativeNumber(value: unknown, path: string): void {
  if (value !== undefined) nonNegativeNumber(value, path);
}

export function validateManagedArtifact(value: unknown, path: string): void {
  if (!isJsonObject(value)) historyError(path, 'requires an object');
  requiredString(value.relativePath, `${path}.relativePath`);
  optionalString(value.mediaType, `${path}.mediaType`);
  nonNegativeNumber(value.sizeBytes, `${path}.sizeBytes`);
  const sha256 = requiredString(value.sha256, `${path}.sha256`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(sha256)) historyError(`${path}.sha256`, 'requires a canonical SHA-256 digest');
  optionalString(value.displayName, `${path}.displayName`);
  if (value.previewSource !== 'managed-asset') historyError(`${path}.previewSource`, 'requires managed-asset');
}

function boundedNonEmptyString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength) historyError(path, 'requires a bounded non-empty string');
  return value as string;
}

function optionalNonEmptyString(value: unknown, path: string, maxLength: number): void {
  if (value !== undefined) boundedNonEmptyString(value, path, maxLength);
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) historyError(path, 'requires a non-negative safe integer');
  return value as number;
}

function validTimestamp(value: unknown, path: string): void {
  if (Number.isNaN(new Date(requiredString(value, path)).valueOf())) historyError(path, 'requires a valid timestamp');
}

function validateHistoryJson(value: unknown, path: string, depth = 0): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (depth > 32) historyError(path, 'exceeds the JSON depth bound');
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateHistoryJson(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isJsonObject(value)) historyError(path, 'requires JSON data');
  for (const [key, entry] of Object.entries(value)) validateHistoryJson(entry, `${path}.${key}`, depth + 1);
}

function validateFaceSwapHistory(value: unknown, path: string): void {
  if (!isJsonObject(value) || !Array.isArray(value.inputs) || value.inputs.length !== 2) historyError(path, 'requires one reference and one target input');
  const roles = new Set<string>();
  for (const [index, input] of value.inputs.entries()) {
    const inputPath = `${path}.inputs[${index}]`;
    if (!isJsonObject(input) || !['reference-image', 'target-image', 'target-video'].includes(String(input.role)) || roles.has(String(input.role))) {
      historyError(inputPath, 'has an invalid or duplicate role');
    }
    roles.add(String(input.role));
    boundedNonEmptyString(input.name, `${inputPath}.name`, 255);
    boundedNonEmptyString(input.mediaType, `${inputPath}.mediaType`, 255);
    nonNegativeSafeInteger(input.sizeBytes, `${inputPath}.sizeBytes`);
    if (!/^sha256:[0-9a-f]{64}$/u.test(requiredString(input.sha256, `${inputPath}.sha256`))) historyError(`${inputPath}.sha256`, 'requires a canonical SHA-256 digest');
  }
  const video = roles.has('target-video');
  if (!roles.has('reference-image') || video === roles.has('target-image')) historyError(path, 'requires exactly one reference image and one target');
  if (video !== (value.noFacePolicy !== undefined)) historyError(`${path}.noFacePolicy`, 'must be present exactly for a video target');
  if (value.noFacePolicy !== undefined && value.noFacePolicy !== 'fail' && value.noFacePolicy !== 'preserve-frame') historyError(`${path}.noFacePolicy`, 'is invalid');
  if (value.video !== undefined) {
    const summary = value.video;
    if (!video || !isJsonObject(summary)) historyError(`${path}.video`, 'requires a video target summary');
    const total = nonNegativeSafeInteger(summary.totalFrames, `${path}.video.totalFrames`);
    const transformed = nonNegativeSafeInteger(summary.transformedFrames, `${path}.video.transformedFrames`);
    const preserved = nonNegativeSafeInteger(summary.preservedFrames, `${path}.video.preservedFrames`);
    nonNegativeSafeInteger(summary.durationUs, `${path}.video.durationUs`);
    if (total !== transformed + preserved || ![24, 25, 30].includes(Number(summary.frameRate)) || typeof summary.audioPreserved !== 'boolean') {
      historyError(`${path}.video`, 'has inconsistent video facts');
    }
  }
}

function validateTextExchangeItem(value: unknown, path: string): void {
  if (!isJsonObject(value)) historyError(path, 'requires an object');
  if (value.type === 'text') {
    requiredString(value.text, `${path}.text`);
    return;
  }
  if (value.type === 'reasoning-continuity') {
    requiredString(value.carrierKind, `${path}.carrierKind`);
    nonNegativeSafeInteger(value.version, `${path}.version`);
    nonNegativeSafeInteger(value.payloadBytes, `${path}.payloadBytes`);
    return;
  }
  if (value.type === 'tool-call' || value.type === 'tool-result') {
    boundedNonEmptyString(value.toolCallId, `${path}.toolCallId`, 128);
    boundedNonEmptyString(value.toolName, `${path}.toolName`, 128);
    validateHistoryJson(value.type === 'tool-call' ? value.arguments : value.result, `${path}.${value.type === 'tool-call' ? 'arguments' : 'result'}`);
    if (value.type === 'tool-result' && typeof value.isError !== 'boolean') historyError(`${path}.isError`, 'requires a boolean');
    return;
  }
  historyError(`${path}.type`, 'has an unsupported value');
}

function decisionProbability(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) historyError(path, 'requires a probability from 0 to 1');
}

// Answers keep submitted order; a choice keeps every submitted candidate once
// and selects one of them.
function validateTextDecisionAnswers(value: unknown, questionCount: number, path: string): void {
  if (!Array.isArray(value) || value.length !== questionCount) historyError(path, 'requires one answer per question');
  const questionIds = new Set<string>();
  value.forEach((answer, index) => {
    const answerPath = `${path}[${index}]`;
    if (!isJsonObject(answer)) historyError(answerPath, 'requires an object');
    const questionId = boundedNonEmptyString(answer.questionId, `${answerPath}.questionId`, 64);
    if (questionIds.has(questionId)) historyError(`${answerPath}.questionId`, 'is repeated');
    questionIds.add(questionId);
    if (answer.kind === 'boolean') {
      decisionProbability(answer.trueProbability, `${answerPath}.trueProbability`);
      return;
    }
    if (answer.kind !== 'choice') historyError(`${answerPath}.kind`, 'has an unsupported value');
    if (!Array.isArray(answer.probabilities) || answer.probabilities.length < 2 || answer.probabilities.length > 255) {
      historyError(`${answerPath}.probabilities`, 'requires 2 to 255 candidates');
    }
    const candidateIds = new Set<string>();
    answer.probabilities.forEach((entry, position) => {
      const entryPath = `${answerPath}.probabilities[${position}]`;
      if (!isJsonObject(entry)) historyError(entryPath, 'requires an object');
      const candidateId = boundedNonEmptyString(entry.candidateId, `${entryPath}.candidateId`, 64);
      if (candidateIds.has(candidateId)) historyError(`${entryPath}.candidateId`, 'is repeated');
      candidateIds.add(candidateId);
      decisionProbability(entry.probability, `${entryPath}.probability`);
    });
    const selected = boundedNonEmptyString(answer.selectedCandidateId, `${answerPath}.selectedCandidateId`, 64);
    if (!candidateIds.has(selected)) historyError(`${answerPath}.selectedCandidateId`, 'is not one of its candidates');
  });
}

export function validateStudioHistoryResult(value: unknown, path: string): void {
  if (!isJsonObject(value) || typeof value.ok !== 'boolean') historyError(path, 'requires a discriminated result object');
  const kind = requiredString(value.kind, `${path}.kind`);
  requiredString(value.summary, `${path}.summary`);
  if (value.ok === false) {
    if (kind !== 'non-success') historyError(`${path}.kind`, 'requires non-success for a failed result');
    if (!['runtime-unavailable', 'input-invalid', 'sdk-method-unavailable', 'principal-unauthorized', 'operation-aborted', 'runtime-canceled', 'runtime-timeout', 'stream-interrupted', 'runtime-call-failed'].includes(String(value.reason))) {
      historyError(`${path}.reason`, 'has an unsupported value');
    }
    requiredString(value.message, `${path}.message`);
    requiredString(value.actionHint, `${path}.actionHint`);
    optionalString(value.missingSurface, `${path}.missingSurface`);
    optionalNonEmptyString(value.jobId, `${path}.jobId`, 128);
    if (value.diagnostics !== undefined) {
      if (!isJsonObject(value.diagnostics)) historyError(`${path}.diagnostics`, 'requires an object');
      const reasonCode = requiredString(value.diagnostics.reasonCode, `${path}.diagnostics.reasonCode`);
      if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(reasonCode)) historyError(`${path}.diagnostics.reasonCode`, 'is invalid');
      const actionHint = value.diagnostics.actionHint;
      optionalString(actionHint, `${path}.diagnostics.actionHint`);
      if (typeof actionHint === 'string' && actionHint && !/^[A-Za-z0-9_.-]{1,256}$/u.test(actionHint)) {
        historyError(`${path}.diagnostics.actionHint`, 'is invalid');
      }
      const traceId = value.diagnostics.traceId;
      optionalString(traceId, `${path}.diagnostics.traceId`);
      if (typeof traceId === 'string' && traceId && !/^[A-Za-z0-9_.:-]{1,512}$/u.test(traceId)) {
        historyError(`${path}.diagnostics.traceId`, 'is invalid');
      }
      const source = value.diagnostics.source;
      optionalString(source, `${path}.diagnostics.source`);
      if (typeof source === 'string' && source && !['runtime', 'sdk', 'realm'].includes(source)) {
        historyError(`${path}.diagnostics.source`, 'is invalid');
      }
      if (value.diagnostics.retryable !== undefined && typeof value.diagnostics.retryable !== 'boolean') {
        historyError(`${path}.diagnostics.retryable`, 'requires a boolean');
      }
    }
    return;
  }
  optionalString(value.traceId, `${path}.traceId`);
  if (kind === 'vision-locate') {
    requiredString(value.jobId, `${path}.jobId`);
    const result = value.result;
    if (result === undefined) return;
    if (!isJsonObject(result) || typeof result.imageArtifactId !== 'string' || !result.imageArtifactId || !Number.isInteger(result.width) || (result.width as number) <= 0 || !Number.isInteger(result.height) || (result.height as number) <= 0 || !Array.isArray(result.locations)) historyError(path, 'requires a typed Locate result');
    for (const location of result.locations) {
      if (!isJsonObject(location)) historyError(path, 'requires a typed location');
      const axes = location.type === 'box' ? ['x1','y1','x2','y2'] : location.type === 'point' ? ['x','y'] : [];
      if (!axes.length || axes.some(axis => typeof location[axis] !== 'number' || !Number.isFinite(location[axis]) || (location[axis] as number) < 0 || (location[axis] as number) > 1)) historyError(path, 'has invalid Locate coordinates');
      if (location.type === 'box' && !((location.x1 as number) < (location.x2 as number) && (location.y1 as number) < (location.y2 as number))) historyError(path, 'has invalid Locate box ordering');
      optionalString(location.label, `${path}.result.locations.label`);
    }
    return;
  }
  if (kind === 'text') {
    requiredString(value.body, `${path}.body`);
    nonNegativeNumber(value.charCount, `${path}.charCount`);
    requiredString(value.finishReason, `${path}.finishReason`);
    if (typeof value.streamed !== 'boolean') historyError(`${path}.streamed`, 'requires a boolean');
    optionalNonNegativeNumber(value.inputTokens, `${path}.inputTokens`);
    optionalNonNegativeNumber(value.outputTokens, `${path}.outputTokens`);
    optionalNonNegativeNumber(value.totalTokens, `${path}.totalTokens`);
    return;
  }
  if (kind === 'embedding') {
    nonNegativeNumber(value.vectorCount, `${path}.vectorCount`);
    nonNegativeNumber(value.dimensions, `${path}.dimensions`);
    // Records saved before the embedding space was retained have no spaceId.
    optionalNonEmptyString(value.spaceId, `${path}.spaceId`, 128);
    if (!Array.isArray(value.sample) || value.sample.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
      historyError(`${path}.sample`, 'requires finite numbers');
    }
    optionalNonNegativeNumber(value.totalTokens, `${path}.totalTokens`);
    return;
  }
  if (kind === 'text-annotation') {
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    if (!/^[a-z-]{2,16}$/u.test(requiredString(value.language, `${path}.language`))) historyError(`${path}.language`, 'is invalid');
    nonNegativeSafeInteger(value.documentCount, `${path}.documentCount`);
    nonNegativeSafeInteger(value.tokenCount, `${path}.tokenCount`);
    nonNegativeSafeInteger(value.sentenceCount, `${path}.sentenceCount`);
    validateManagedArtifact(value.document, `${path}.document`);
    if (!isJsonObject(value.document) || value.document.mediaType !== 'application/json') historyError(`${path}.document`, 'requires a saved JSON document');
    return;
  }
  if (kind === 'text-exchange') {
    if (value.scenario !== 'tool-call' && value.scenario !== 'structured-output') historyError(`${path}.scenario`, 'is invalid');
    if (!Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 16) historyError(`${path}.steps`, 'requires 1 to 16 steps');
    value.steps.forEach((step, index) => {
      const stepPath = `${path}.steps[${index}]`;
      if (!isJsonObject(step) || (step.origin !== 'model' && step.origin !== 'app') || !Array.isArray(step.items) || step.items.length === 0 || step.items.length > 64) {
        historyError(stepPath, 'requires an origin and 1 to 64 items');
      }
      optionalString(step.finishReason, `${stepPath}.finishReason`);
      optionalString(step.traceId, `${stepPath}.traceId`);
      step.items.forEach((item, itemIndex) => validateTextExchangeItem(item, `${stepPath}.items[${itemIndex}]`));
    });
    requiredString(value.text, `${path}.text`);
    if (value.structured !== undefined) validateHistoryJson(value.structured, `${path}.structured`);
    return;
  }
  if (kind === 'text-decision') {
    const questionCount = nonNegativeSafeInteger(value.questionCount, `${path}.questionCount`);
    if (questionCount < 1 || questionCount > 64) historyError(`${path}.questionCount`, 'requires 1 to 64 questions');
    if (value.answers !== undefined) validateTextDecisionAnswers(value.answers, questionCount, `${path}.answers`);
    return;
  }
  if (kind === 'session') {
    requiredString(value.capabilityContract, `${path}.capabilityContract`);
    validTimestamp(value.startedAt, `${path}.startedAt`);
    validTimestamp(value.endedAt, `${path}.endedAt`);
    if (value.ending !== 'closed' && value.ending !== 'terminated') historyError(`${path}.ending`, 'is invalid');
    requiredString(value.terminalReason, `${path}.terminalReason`);
    if (!isJsonObject(value.observed) || Object.keys(value.observed).length > 32) historyError(`${path}.observed`, 'requires at most 32 counters');
    for (const [key, count] of Object.entries(value.observed)) {
      if (!/^[a-z][a-z0-9-]{0,63}$/u.test(key)) historyError(`${path}.observed`, `has an invalid counter ${key}`);
      nonNegativeSafeInteger(count, `${path}.observed.${key}`);
    }
    return;
  }
  if (kind === 'artifacts') {
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    nonNegativeNumber(value.artifactCount, `${path}.artifactCount`);
    if (value.artifacts !== undefined) {
      if (!Array.isArray(value.artifacts)) historyError(`${path}.artifacts`, 'requires an array');
      value.artifacts.forEach((artifact, index) => validateManagedArtifact(artifact, `${path}.artifacts[${index}]`));
      if (value.artifacts.length !== value.artifactCount) historyError(`${path}.artifacts`, 'must match artifactCount');
    }
    if (value.firstArtifact !== undefined) validateManagedArtifact(value.firstArtifact, `${path}.firstArtifact`);
    if (value.faceSwap !== undefined) {
      if (value.musicGeneration !== undefined || value.musicTranscription !== undefined || value.voiceConversion !== undefined || value.audioSeparation !== undefined) {
        historyError(path, 'mixes face replacement with another result');
      }
      validateFaceSwapHistory(value.faceSwap, `${path}.faceSwap`);
    }
    if (value.musicTranscription !== undefined) {
      const music = value.musicTranscription;
      if (value.musicGeneration !== undefined || !isJsonObject(music) || !isJsonObject(music.sourceInfo)
        || !isJsonObject(music.inputRange) || !Array.isArray(music.scores) || !Array.isArray(value.artifacts)
        || music.origin !== 'transcribed-estimate' || !['unknown', 'complete', 'truncated'].includes(String(music.completeness))) historyError(path, 'requires complete transcription metadata');
      validateManagedArtifact(music.sourceAudio, `${path}.sourceAudio`);
      if (!isJsonObject(music.sourceAudio) || music.sourceAudio.mediaType !== 'audio/wav') historyError(path, 'requires saved canonical source audio');
      const audio = music.sourceInfo;
      for (const key of ['sampleRateHz', 'channels', 'frameCount', 'durationMs']) {
        if (typeof audio[key] !== 'number' || !Number.isSafeInteger(audio[key])) historyError(path, 'has invalid transcription source facts');
      }
      if (Number(audio.sampleRateHz) < 8000 || Number(audio.sampleRateHz) > 96000 || ![1, 2].includes(Number(audio.channels))
        || Number(audio.frameCount) < 1 || Number(audio.frameCount) > Number(audio.sampleRateHz) * 600
        || audio.durationMs !== Math.floor(Number(audio.frameCount) * 1000 / Number(audio.sampleRateHz))) historyError(path, 'has inconsistent transcription source facts');
      const range = music.inputRange;
      if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || Number(range.startFrame) < 0
        || Number(range.endFrame) > Number(audio.frameCount) || Number(range.startFrame) >= Number(range.endFrame)) historyError(path, 'has an invalid transcription range');
      const expected = new Map<string, string>(); const pairs = new Set<string>();
      for (const score of music.scores) {
        if (!isJsonObject(score) || typeof score.relativePath !== 'string' || !['abc', 'midi'].includes(String(score.format))
          || !['vocal-melody', 'lead-sheet', 'full-arrangement'].includes(String(score.part))) historyError(path, 'has an invalid transcribed score');
        const pair = `${score.format}:${score.part}`;
        if (pairs.has(pair) || expected.has(score.relativePath)) historyError(path, 'duplicates a transcribed score');
        pairs.add(pair); expected.set(score.relativePath, score.format === 'abc' ? 'text/vnd.abc' : 'audio/midi');
      }
      if (music.timelineRelativePath !== undefined) {
        const timeline = requiredString(music.timelineRelativePath, `${path}.timelineRelativePath`);
        if (expected.has(timeline)) historyError(path, 'duplicates its timeline');
        expected.set(timeline, 'application/vnd.nimi.music-timeline+json');
      }
      if (!expected.size || value.artifacts.length !== expected.size) historyError(path, 'does not retain its complete transcription');
      for (const artifact of value.artifacts) {
        if (!isJsonObject(artifact) || typeof artifact.relativePath !== 'string' || expected.get(artifact.relativePath) !== artifact.mediaType) historyError(path, 'has mismatched transcription artifacts');
        expected.delete(artifact.relativePath);
      }
    }
    if (value.voiceConversion !== undefined) {
      const voice = value.voiceConversion;
      if (value.musicGeneration !== undefined || value.musicTranscription !== undefined || !isJsonObject(voice) || !isJsonObject(voice.sourceInfo)
        || !isJsonObject(voice.inputRange) || !isJsonObject(voice.vocalInfo) || !isJsonObject(voice.vocal) || !Array.isArray(value.artifacts)
        || !['EXACT', 'MODEL_FRAME_ROUNDING'].includes(String(voice.lengthRelation))) historyError(path, 'requires complete voice conversion metadata');
      validateManagedArtifact(voice.sourceVocal, `${path}.sourceVocal`);
      if (!isJsonObject(voice.sourceVocal) || voice.sourceVocal.mediaType !== 'audio/wav') historyError(path, 'requires saved canonical source vocal');
      if (voice.targetVoice !== undefined) {
        validateManagedArtifact(voice.targetVoice, `${path}.targetVoice`);
        if (!isJsonObject(voice.targetVoice) || voice.targetVoice.mediaType !== 'audio/wav') historyError(path, 'requires saved canonical target voice');
      }
      const source = voice.sourceInfo;
      const vocal = voice.vocalInfo;
      for (const key of ['sampleRateHz', 'channels', 'frameCount', 'durationMs']) {
        if (typeof source[key] !== 'number' || !Number.isSafeInteger(source[key])) historyError(path, 'has invalid voice conversion source facts');
        if (typeof vocal[key] !== 'number' || !Number.isSafeInteger(vocal[key])) historyError(path, 'has invalid voice conversion vocal facts');
      }
      for (const audio of [source, vocal]) {
        if (Number(audio.sampleRateHz) < 8000 || Number(audio.sampleRateHz) > 96000 || ![1, 2].includes(Number(audio.channels))
          || Number(audio.frameCount) < 1 || Number(audio.frameCount) > Number(audio.sampleRateHz) * 600
          || audio.durationMs !== Math.floor(Number(audio.frameCount) * 1000 / Number(audio.sampleRateHz))) historyError(path, 'has inconsistent voice conversion facts');
      }
      const range = voice.inputRange;
      if (!Number.isSafeInteger(range.startFrame) || !Number.isSafeInteger(range.endFrame) || Number(range.startFrame) < 0
        || Number(range.endFrame) > Number(source.frameCount) || Number(range.startFrame) >= Number(range.endFrame)) historyError(path, 'has an invalid voice conversion range');
      const sourceRangeDurationMs = Math.floor((Number(range.endFrame) - Number(range.startFrame)) * 1000 / Number(source.sampleRateHz));
      if (typeof voice.durationDeltaMs !== 'number' || !Number.isSafeInteger(voice.durationDeltaMs)
        || voice.durationDeltaMs !== Number(vocal.durationMs) - sourceRangeDurationMs) historyError(path, 'has an inconsistent voice conversion duration delta');
      if (voice.lengthRelation === 'EXACT' && voice.durationDeltaMs !== 0) historyError(path, 'has an inconsistent voice conversion length relation');
      if (voice.lengthRelation === 'MODEL_FRAME_ROUNDING' && Math.abs(Number(voice.durationDeltaMs)) >= 1000) historyError(path, 'has an inconsistent voice conversion length relation');
      validateManagedArtifact(voice.vocal, `${path}.vocal`);
      if (!isJsonObject(voice.vocal) || voice.vocal.mediaType !== 'audio/wav') historyError(path, 'does not retain its converted vocal');
      const vocalPath = requiredString(voice.vocal.relativePath, `${path}.vocal.relativePath`);
      if (value.artifacts.length !== 1
        || !value.artifacts.some((artifact) => isJsonObject(artifact) && artifact.relativePath === vocalPath && artifact.mediaType === 'audio/wav')) {
        historyError(path, 'does not retain its converted vocal');
      }
    }
    if (value.audioSeparation !== undefined) {
      const separation = value.audioSeparation;
      if (value.musicGeneration !== undefined || value.musicTranscription !== undefined || value.voiceConversion !== undefined
        || !isJsonObject(separation) || !isJsonObject(separation.vocals) || !isJsonObject(separation.background) || !Array.isArray(value.artifacts)) {
        historyError(path, 'requires complete audio separation metadata');
      }
      validateManagedArtifact(separation.sourceAudio, `${path}.sourceAudio`);
      if (!isJsonObject(separation.sourceAudio) || separation.sourceAudio.mediaType !== 'audio/wav') historyError(path, 'requires saved canonical source audio');
      validateManagedArtifact(separation.vocals, `${path}.vocals`);
      validateManagedArtifact(separation.background, `${path}.background`);
      if (!isJsonObject(separation.vocals) || separation.vocals.mediaType !== 'audio/wav'
        || !isJsonObject(separation.background) || separation.background.mediaType !== 'audio/wav') historyError(path, 'does not retain its separation stems');
      const vocalsPath = requiredString(separation.vocals.relativePath, `${path}.vocals.relativePath`);
      const backgroundPath = requiredString(separation.background.relativePath, `${path}.background.relativePath`);
      if (vocalsPath === backgroundPath) historyError(path, 'has identical vocal and background stems');
      const parts = separation.instrumentParts === undefined ? [] : separation.instrumentParts;
      if (!Array.isArray(parts) || parts.length > 3) historyError(path, 'has invalid instrument parts');
      const expected = new Map<string, string>([[vocalsPath, 'audio/wav'], [backgroundPath, 'audio/wav']]);
      const kinds = new Set<string>();
      for (const part of parts) {
        if (!isJsonObject(part) || !['DRUMS', 'BASS', 'OTHER'].includes(String(part.kind)) || kinds.has(String(part.kind))) {
          historyError(path, 'has an invalid instrument part');
        }
        kinds.add(String(part.kind));
        validateManagedArtifact(part.artifact, `${path}.instrumentParts.artifact`);
        if (!isJsonObject(part.artifact) || part.artifact.mediaType !== 'audio/wav') historyError(path, 'does not retain its instrument stem');
        const partPath = requiredString(part.artifact.relativePath, `${path}.instrumentParts.artifact.relativePath`);
        if (expected.has(partPath)) historyError(path, 'duplicates a separation stem');
        expected.set(partPath, 'audio/wav');
      }
      if (value.artifacts.length !== expected.size) historyError(path, 'does not retain its complete separation');
      for (const artifact of value.artifacts) {
        if (!isJsonObject(artifact) || typeof artifact.relativePath !== 'string' || expected.get(artifact.relativePath) !== artifact.mediaType) {
          historyError(path, 'has mismatched separation artifacts');
        }
        expected.delete(artifact.relativePath);
      }
    }
    if (value.musicGeneration !== undefined) {
      const music = value.musicGeneration;
      if (!isJsonObject(music) || !isJsonObject(music.audioInfo) || !Array.isArray(value.artifacts)) historyError(path, 'requires complete music metadata');
      const audio = music.audioInfo;
      if (!['unknown', 'model-end', 'budget-limit'].includes(String(music.termination))) historyError(path, 'has an invalid music termination');
      for (const key of ['sampleRateHz', 'channels', 'frameCount', 'durationMs']) {
        if (typeof audio[key] !== 'number' || !Number.isSafeInteger(audio[key]) || Number(audio[key]) < 0) historyError(path, 'has invalid canonical audio facts');
      }
      if (Number(audio.sampleRateHz) < 8000 || Number(audio.sampleRateHz) > 96000 || ![1, 2].includes(Number(audio.channels))
        || Number(audio.frameCount) < 1 || Number(audio.frameCount) > Number(audio.sampleRateHz) * 600
        || audio.durationMs !== Math.floor(Number(audio.frameCount) * 1000 / Number(audio.sampleRateHz))) historyError(path, 'has inconsistent canonical audio facts');
      if (music.actualSeed !== undefined && (typeof music.actualSeed !== 'number' || !Number.isSafeInteger(music.actualSeed) || music.actualSeed < 0 || music.actualSeed > 4294967295)) historyError(path, 'has an invalid music seed');
      if (!value.artifacts.some((artifact) => isJsonObject(artifact) && artifact.relativePath === music.mixRelativePath && artifact.mediaType === 'audio/wav')) historyError(path, 'does not retain its mix');
      if (music.generatedScore !== undefined) {
        const score = music.generatedScore;
        if (!isJsonObject(score) || score.format !== 'abc' || score.origin !== 'generated-plan' || typeof score.truncated !== 'boolean'
          || !value.artifacts.some((artifact) => isJsonObject(artifact) && artifact.relativePath === score.relativePath && artifact.mediaType === 'text/vnd.abc')) historyError(path, 'does not retain its generated score');
      }
    }
    return;
  }
  if (kind === 'transcript') {
    requiredString(value.body, `${path}.body`);
    nonNegativeNumber(value.charCount, `${path}.charCount`);
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    nonNegativeNumber(value.artifactCount, `${path}.artifactCount`);
    return;
  }
  if (kind === 'voice-asset') {
    requiredString(value.jobId, `${path}.jobId`);
    requiredString(value.jobState, `${path}.jobState`);
    requiredString(value.voiceAssetId, `${path}.voiceAssetId`);
    if (value.creationSource !== 'reference-audio' && value.creationSource !== 'text-description') historyError(`${path}.creationSource`, 'is invalid');
    requiredString(value.assetStatus, `${path}.assetStatus`);
    return;
  }
  if (kind === 'voice-catalog') {
    nonNegativeNumber(value.voiceCount, `${path}.voiceCount`);
    if (!Array.isArray(value.sample)) historyError(`${path}.sample`, 'requires an array');
    value.sample.forEach((entry, index) => {
      if (!isJsonObject(entry)) historyError(`${path}.sample[${index}]`, 'requires an object');
      requiredString(entry.voiceId, `${path}.sample[${index}].voiceId`);
      requiredString(entry.creationSource, `${path}.sample[${index}].creationSource`);
      requiredString(entry.status, `${path}.sample[${index}].status`);
    });
    return;
  }
  historyError(`${path}.kind`, `has unsupported value ${kind}`);
}

function validateRunConfig(value: unknown, path: string): void {
  if (!isJsonObject(value) || !isJsonObject(value.target) || !isJsonObject(value.promptControls)) {
    historyError(path, 'requires target and promptControls objects');
  }
  const target = value.target;
  requiredString(target.capabilityId, `${path}.target.capabilityId`);
  if (target.capabilityContract !== null) requiredString(target.capabilityContract, `${path}.target.capabilityContract`);
  for (const field of ['section', 'status', 'source', 'intentLabel', 'detail'] as const) requiredString(target[field], `${path}.target.${field}`);
  if (!isJsonObject(target.params)) historyError(`${path}.target.params`, 'requires an object');
  if (!Array.isArray(target.paramsSummary) || target.paramsSummary.some((entry) => typeof entry !== 'string')) historyError(`${path}.target.paramsSummary`, 'requires strings');
  if (target.profileOrigin !== null) historyError(`${path}.target.profileOrigin`, 'requires null');
  const controls = value.promptControls;
  optionalString(controls.tone, `${path}.promptControls.tone`);
  optionalString(controls.length, `${path}.promptControls.length`);
  if (controls.toneSelected !== undefined && typeof controls.toneSelected !== 'boolean') historyError(`${path}.promptControls.toneSelected`, 'requires a boolean');
  if (controls.lengthSelected !== undefined && typeof controls.lengthSelected !== 'boolean') historyError(`${path}.promptControls.lengthSelected`, 'requires a boolean');
  if (typeof controls.contextAttached !== 'boolean') historyError(`${path}.promptControls.contextAttached`, 'requires a boolean');
  optionalString(controls.context, `${path}.promptControls.context`);
  nonNegativeNumber(controls.attachmentCount, `${path}.promptControls.attachmentCount`);
  optionalString(value.traceId, `${path}.traceId`);
}

function parseHistoryRecord(value: unknown, path: string, capabilityId: string): StudioRunHistoryRecord {
  if (!isJsonObject(value)) historyError(path, 'requires an object');
  requiredString(value.id, `${path}.id`);
  if (requiredString(value.capabilityId, `${path}.capabilityId`) !== capabilityId) historyError(`${path}.capabilityId`, `must match ${capabilityId}`);
  requiredString(value.prompt, `${path}.prompt`);
  if (!['unavailable', 'ready', 'failed', 'canceled', 'timed-out', 'local-fixture'].includes(String(value.status))) historyError(`${path}.status`, 'has an unsupported value');
  requiredString(value.message, `${path}.message`);
  const createdAt = requiredString(value.createdAt, `${path}.createdAt`);
  if (Number.isNaN(new Date(createdAt).valueOf())) historyError(`${path}.createdAt`, 'requires a valid timestamp');
  if (value.result !== undefined) validateStudioHistoryResult(value.result, `${path}.result`);
  if (value.runConfig !== undefined) validateRunConfig(value.runConfig, `${path}.runConfig`);
  if (value.inputTruncated !== undefined) {
    if (value.inputTruncated !== true) historyError(`${path}.inputTruncated`, 'requires true when present');
    const context = isJsonObject(value.runConfig) && isJsonObject(value.runConfig.promptControls) ? value.runConfig.promptControls.context : undefined;
    for (const [field, text] of [['prompt', value.prompt], ['runConfig.promptControls.context', context]] as const) {
      if (typeof text === 'string' && utf8ByteLength(text) > STUDIO_HISTORY_INPUT_LIMIT_BYTES) historyError(`${path}.${field}`, 'exceeds the truncated input limit');
    }
  }
  return value as unknown as StudioRunHistoryRecord;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

// Keeps whole code points only, so a preview never ends in half a character.
function boundedHistoryInput(text: string): { readonly text: string; readonly truncated: boolean } {
  if (utf8ByteLength(text) <= STUDIO_HISTORY_INPUT_LIMIT_BYTES) return { text, truncated: false };
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = utf8ByteLength(character);
    if (bytes + size > STUDIO_HISTORY_INPUT_LIMIT_BYTES) break;
    bytes += size;
    end += character.length;
  }
  return { text: text.slice(0, end), truncated: true };
}

// The stored copy keeps a bounded preview of long input text; the run that
// produced the record keeps its complete input for the rest of the session.
function boundStudioHistoryInput(record: StudioRunHistoryRecord): StudioRunHistoryRecord {
  const prompt = boundedHistoryInput(record.prompt);
  const context = record.runConfig?.promptControls.context;
  const boundedContext = context === undefined ? undefined : boundedHistoryInput(context);
  if (!prompt.truncated && !boundedContext?.truncated) return record;
  return {
    ...record,
    prompt: prompt.text,
    ...(record.runConfig && boundedContext
      ? { runConfig: { ...record.runConfig, promptControls: { ...record.runConfig.promptControls, context: boundedContext.text } } }
      : {}),
    inputTruncated: true,
  };
}

export function parseStudioRunHistory(value: unknown): StudioRunHistory {
  if (value === undefined) return {};
  if (!isJsonObject(value)) throw new Error('AI Studio history payload must be an object.');
  const history: StudioRunHistory = {};
  for (const [capabilityId, entries] of Object.entries(value)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(capabilityId)) historyError('$', `contains invalid capability id ${capabilityId}`);
    if (!Array.isArray(entries)) historyError(`$.${capabilityId}`, 'requires an array');
    history[capabilityId] = entries.map((entry, index) => parseHistoryRecord(entry, `$.${capabilityId}[${index}]`, capabilityId));
  }
  return history;
}

export function flattenStudioHistoryRecords(history: StudioRunHistory): StudioRunHistoryRecord[] {
  return Object.values(history).flatMap((records) => records);
}

export function studioHistoryFromRecords(records: readonly StudioRunHistoryRecord[]): StudioRunHistory {
  const history: StudioRunHistory = {};
  for (const record of records) {
    const existing = Object.hasOwn(history, record.capabilityId) ? history[record.capabilityId] ?? [] : [];
    Object.defineProperty(history, record.capabilityId, {
      value: [...existing, record],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return history;
}

export function boundStudioRunHistoryWithRecord(history: StudioRunHistory, record: StudioRunHistoryRecord): StudioRunHistory {
  // History has a smaller JSON budget than a long input or a complete Runtime
  // Locate result. The stored copy keeps an input preview and the summary/Job
  // reference without mutating the current full result.
  let storedRecord = boundStudioHistoryInput(record);
  if (storedRecord.result?.ok && storedRecord.result.kind === 'vision-locate' && storedRecord.result.result
    && utf8ByteLength(JSON.stringify(studioHistoryFromRecords([storedRecord]))) > STUDIO_HISTORY_LIMIT_BYTES) {
    const { result: _locations, ...reference } = storedRecord.result;
    storedRecord = { ...storedRecord, result: reference };
  }
  // Every submitted candidate keeps its probability, so many large choices can
  // outgrow the whole budget; the stored copy then keeps the summary alone.
  if (storedRecord.result?.ok && storedRecord.result.kind === 'text-decision' && storedRecord.result.answers
    && utf8ByteLength(JSON.stringify(studioHistoryFromRecords([storedRecord]))) > STUDIO_HISTORY_LIMIT_BYTES) {
    const { answers: _answers, ...summary } = storedRecord.result;
    storedRecord = { ...storedRecord, result: summary };
  }
  const counts = new Map<string, number>();
  const retained = [storedRecord, ...flattenStudioHistoryRecords(history).filter((existing) => existing.id !== record.id)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .filter((candidate) => {
      const count = counts.get(candidate.capabilityId) ?? 0;
      if (count >= STUDIO_HISTORY_LIMIT_PER_CAPABILITY) return false;
      counts.set(candidate.capabilityId, count + 1);
      return true;
    })
    .slice(0, STUDIO_HISTORY_LIMIT_TOTAL_RECORDS);
  let next = studioHistoryFromRecords(retained);
  while (new TextEncoder().encode(JSON.stringify(next)).byteLength > STUDIO_HISTORY_LIMIT_BYTES) {
    if (retained.length <= 1) throw new Error('AI Studio history record exceeds the storage document limit.');
    retained.pop();
    next = studioHistoryFromRecords(retained);
  }
  if (!retained.some((candidate) => candidate.id === record.id)) throw new Error('AI Studio history could not retain the newly completed run.');
  return next;
}

export function removeStudioRunHistoryRecord(history: StudioRunHistory, recordId: string): StudioRunHistory {
  return studioHistoryFromRecords(flattenStudioHistoryRecords(history).filter((record) => record.id !== recordId));
}

export function clearStudioRunHistory(history: StudioRunHistory, capabilityId: string | null): StudioRunHistory {
  if (capabilityId === null) return {};
  return studioHistoryFromRecords(flattenStudioHistoryRecords(history).filter((record) => record.capabilityId !== capabilityId));
}

export type StudioHistoryPolicyMutationIssue = {
  readonly runId: string;
  readonly step: 'asset' | 'history';
  readonly message: string;
};

export type StudioHistoryPolicyMutationOutcome<TProjection> = {
  readonly completed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly projection: TProjection;
  readonly issues: readonly StudioHistoryPolicyMutationIssue[];
};

export function studioHistoryClearOutcomeTone(outcome: {
  readonly skipped: number;
  readonly failed: number;
}): 'success' | 'warning' | 'danger' {
  if (outcome.failed > 0) return 'danger';
  if (outcome.skipped > 0) return 'warning';
  return 'success';
}

export type StudioHistoryMutationSubject = {
  readonly id: string;
  readonly capabilityId: string;
  readonly artifactPaths: readonly string[];
};

export function studioHistoryArtifactPaths(record: StudioRunHistoryRecord): string[] {
  const result = record.result;
  if (!result || result.ok === false) return [];
  if (result.kind === 'text-annotation') return studioHistoryDocumentPaths(record);
  if (result.kind !== 'artifacts') return [];
  const artifacts = result.artifacts?.length ? result.artifacts : result.firstArtifact ? [result.firstArtifact] : [];
  return artifacts.map((artifact) => artifact.relativePath).filter(Boolean);
}

/**
 * Saved result documents that only the run history references. Unlike media
 * outputs, no media index or other App document keeps them reachable, so a
 * record leaving the bounded history also releases its document.
 */
export function studioHistoryDocumentPaths(record: StudioRunHistoryRecord): string[] {
  const result = record.result;
  if (!result || result.ok === false || result.kind !== 'text-annotation') return [];
  return result.document.relativePath ? [result.document.relativePath] : [];
}

export function studioHistoryEvictedDocumentPaths(
  previous: StudioRunHistory,
  added: StudioRunHistoryRecord,
  retained: StudioRunHistory,
): string[] {
  const retainedPaths = new Set(flattenStudioHistoryRecords(retained).flatMap(studioHistoryDocumentPaths));
  return [...new Set([...flattenStudioHistoryRecords(previous), added].flatMap(studioHistoryDocumentPaths))]
    .filter((relativePath) => !retainedPaths.has(relativePath))
    .sort((left, right) => left.localeCompare(right));
}

export async function cleanupStudioHistoryArtifacts(input: {
  readonly relativePaths: readonly string[];
  readonly removeArtifact: (relativePath: string) => Promise<unknown>;
  readonly isNotFound?: (error: unknown) => boolean;
}): Promise<{ readonly failures: readonly string[]; readonly remainingCleanupPaths: readonly string[] }> {
  const failures: string[] = [];
  const remainingCleanupPaths: string[] = [];
  for (const relativePath of [...new Set(input.relativePaths)]) {
    try {
      await input.removeArtifact(relativePath);
    } catch (error) {
      if (input.isNotFound?.(error)) continue;
      failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      remainingCleanupPaths.push(relativePath);
    }
  }
  return { failures, remainingCleanupPaths };
}

type StudioHistoryMutationPolicyPort<TProjection> = {
  readonly deleteAssets: boolean;
  readonly additionalSubjects?: readonly StudioHistoryMutationSubject[];
  readonly removeArtifact: (relativePath: string) => Promise<unknown>;
  readonly isNotFound?: (error: unknown) => boolean;
  readonly resolveArtifactPaths?: (record: StudioRunHistoryRecord) => readonly string[];
  readonly commit: (
    next: StudioRunHistory,
    removed: readonly StudioHistoryMutationSubject[],
  ) => Promise<void>;
  readonly project: (history: StudioRunHistory) => Promise<TProjection>;
};

function mutationIssue(
  subject: StudioHistoryMutationSubject,
  step: 'asset' | 'history',
  message: string,
): StudioHistoryPolicyMutationIssue {
  return { runId: subject.id, step, message: message || 'History mutation failed.' };
}

function mutationSubjects<TProjection>(
  input: StudioHistoryMutationPolicyPort<TProjection>,
  history: StudioRunHistory,
): StudioHistoryMutationSubject[] {
  const subjects = flattenStudioHistoryRecords(history).map((record) => ({
    id: record.id,
    capabilityId: record.capabilityId,
    artifactPaths: input.resolveArtifactPaths?.(record) ?? studioHistoryArtifactPaths(record),
  }));
  const runOwnedIDs = new Set(subjects.map((subject) => subject.id));
  for (const subject of input.additionalSubjects ?? []) {
    if (!subject.id || !subject.capabilityId || !Array.isArray(subject.artifactPaths)) {
      throw new Error('AI Studio history mutation subject is invalid.');
    }
    if (subject.artifactPaths.some((relativePath) => typeof relativePath !== 'string' || !relativePath)) {
      throw new Error(`AI Studio history mutation subject has an invalid artifact path: ${subject.id}`);
    }
    if (!runOwnedIDs.has(subject.id)) {
      subjects.push(subject);
      runOwnedIDs.add(subject.id);
    }
  }
  return subjects;
}

export async function removeStudioHistoryWithPolicy<TProjection>(input: {
  readonly history: StudioRunHistory;
  readonly recordId: string;
} & StudioHistoryMutationPolicyPort<TProjection>): Promise<StudioHistoryPolicyMutationOutcome<TProjection>> {
  const removed = mutationSubjects(input, input.history).filter((subject) => subject.id === input.recordId);
  const currentProjection = await input.project(input.history);
  if (removed.length === 0) return { completed: 0, skipped: 1, failed: 0, projection: currentProjection, issues: [] };
  if (input.deleteAssets) {
    const cleanup = await cleanupStudioHistoryArtifacts({
      relativePaths: removed.flatMap((subject) => subject.artifactPaths),
      removeArtifact: input.removeArtifact,
      isNotFound: input.isNotFound,
    });
    if (cleanup.failures.length > 0) {
      const message = cleanup.failures.join('; ');
      return {
        completed: 0,
        skipped: removed.length,
        failed: 0,
        projection: currentProjection,
        issues: removed.map((subject) => mutationIssue(subject, 'asset', message)),
      };
    }
  }
  const next = removeStudioRunHistoryRecord(input.history, input.recordId);
  try {
    await input.commit(next, removed);
    return { completed: removed.length, skipped: 0, failed: 0, projection: await input.project(next), issues: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      completed: 0,
      skipped: 0,
      failed: removed.length,
      projection: await input.project(input.history),
      issues: removed.map((subject) => mutationIssue(subject, 'history', message)),
    };
  }
}

export async function clearStudioHistoryWithPolicy<TProjection>(input: {
  readonly history: StudioRunHistory;
  readonly capabilityId: string | null;
} & StudioHistoryMutationPolicyPort<TProjection>): Promise<StudioHistoryPolicyMutationOutcome<TProjection>> {
  const removed = mutationSubjects(input, input.history).filter((subject) => (
    input.capabilityId === null || subject.capabilityId === input.capabilityId
  ));
  if (!input.deleteAssets) {
    const next = clearStudioRunHistory(input.history, input.capabilityId);
    try {
      await input.commit(next, removed);
      return { completed: removed.length, skipped: 0, failed: 0, projection: await input.project(next), issues: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        completed: 0,
        skipped: 0,
        failed: removed.length || 1,
        projection: await input.project(input.history),
        issues: removed.map((subject) => mutationIssue(subject, 'history', message)),
      };
    }
  }

  let history = input.history;
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const issues: StudioHistoryPolicyMutationIssue[] = [];
  for (const subject of removed) {
    const cleanup = await cleanupStudioHistoryArtifacts({
      relativePaths: subject.artifactPaths,
      removeArtifact: input.removeArtifact,
      isNotFound: input.isNotFound,
    });
    if (cleanup.failures.length > 0) {
      skipped += 1;
      issues.push(mutationIssue(subject, 'asset', cleanup.failures.join('; ')));
      continue;
    }
    const next = removeStudioRunHistoryRecord(history, subject.id);
    try {
      await input.commit(next, [subject]);
      history = next;
      completed += 1;
    } catch (error) {
      failed += 1;
      issues.push(mutationIssue(subject, 'history', error instanceof Error ? error.message : String(error)));
    }
  }
  return { completed, skipped, failed, projection: await input.project(history), issues };
}

export function parseAIStudioHistoryPanelPreferences(value: unknown): AIStudioHistoryPanelPreferences {
  if (!isJsonObject(value)
    || typeof value.collapsed !== 'boolean'
    || typeof value.hideFailures !== 'boolean'
    || !['capability', 'all', 'media'].includes(String(value.scope))) {
    throw new Error('AI Studio history panel preferences are invalid.');
  }
  return { collapsed: value.collapsed, scope: value.scope as AIStudioHistoryPanelPreferences['scope'], hideFailures: value.hideFailures };
}
