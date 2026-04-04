import { getPlatformClient } from '@nimiplatform/sdk';

export interface VoiceObservationTranscription {
  transcript: string;
  artifacts: Array<{ artifactId?: string; mimeType?: string; displayName?: string }>;
  trace: {
    traceId?: string;
    modelResolved?: string;
    routeDecision?: string;
  };
}

function toArtifactMetadata(
  artifacts: ReadonlyArray<{ artifactId?: string; mimeType?: string; displayName?: string }> | undefined,
) {
  return Array.isArray(artifacts) ? artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    mimeType: artifact.mimeType,
    displayName: artifact.displayName,
  })) : [];
}

export async function hasVoiceTranscriptionRuntime() {
  try {
    const client = getPlatformClient();
    return Boolean(client.runtime?.appId && client.runtime.media?.stt?.transcribe);
  } catch {
    return false;
  }
}

export async function transcribeVoiceObservation(input: {
  audioBlob: Blob;
  mimeType: string;
}): Promise<VoiceObservationTranscription> {
  const client = getPlatformClient();
  if (!client.runtime?.media?.stt?.transcribe) {
    throw new Error('ParentOS voice transcription runtime is unavailable');
  }

  const mimeType = input.mimeType.trim();
  if (!mimeType) {
    throw new Error('voice observation transcription requires a mimeType');
  }

  const audioBytes = new Uint8Array(await input.audioBlob.arrayBuffer());
  if (audioBytes.length === 0) {
    throw new Error('voice observation transcription requires audio bytes');
  }

  const output = await client.runtime.media.stt.transcribe({
    model: 'auto',
    route: 'local',
    audio: { kind: 'bytes', bytes: audioBytes },
    mimeType,
    language: 'zh-CN',
    responseFormat: 'text',
    metadata: {
      callerKind: 'third-party-app',
      callerId: 'app.nimi.parentos',
      surfaceId: 'parentos.journal.voice-observation',
    },
  });

  const transcript = output.text.trim();
  if (!transcript) {
    throw new Error('runtime speechTranscribe output is missing transcript text');
  }

  return {
    transcript,
    artifacts: toArtifactMetadata(output.artifacts),
    trace: {
      traceId: output.trace.traceId,
      modelResolved: output.trace.modelResolved,
      routeDecision: output.trace.routeDecision,
    },
  };
}
