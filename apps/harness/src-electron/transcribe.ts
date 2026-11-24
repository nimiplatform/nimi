import { extname, resolve } from 'node:path';
import { defineExtension, defineTool } from '@earendil-works/pi-durable';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { obj, str } from '@earendil-works/pi-schema';
import { createNimiLocalAppRuntimeScenarioJobClient } from '@nimiplatform/sdk/app';
import { runRuntimeSpeechTranscribe } from '@nimiplatform/kit/features/generation/runtime';
import type { NimiElectronAppBusinessServices } from '@nimiplatform/kit/shell/electron/main';

const audioTypes: Record<string, string> = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm' };
const maxRecordingBytes = 32 * 1024 * 1024;

/** A model receives a transcript only after the protected transcription Job completes. */
export function transcriptionTools(
  ai: NimiElectronAppBusinessServices['ai'],
  workspace: string | (() => string),
  sessionId: string,
  account: AbortSignal,
  getConfigRef?: () => string | undefined,
) {
  const resolveWorkspace = () => (typeof workspace === 'function' ? workspace() : workspace);
  return defineExtension({ name: 'nimi-harness.recordings', tools: [defineTool({
    name: 'transcribe_audio', description: 'Transcribe a local recording with the speech model configured for this app in Nimi. Read the transcript before summarizing it. The user reviews the path before the recording is sent.',
    parameters: obj({ path: str({ description: 'Recording path, absolute or relative to this session’s working directory.' }) }),
    replay: 'unsafe',
    async execute({ path }, api, context) {
      const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, account]) : account;
      signal.throwIfAborted();
      if (!api.env) throw new Error('The session file environment is unavailable.');
      const mimeType = audioTypes[extname(path).toLowerCase()];
      if (!mimeType) throw new Error('Choose a WAV, MP3, M4A, Ogg, FLAC or WebM audio file.');
      const reader = getOrThrow(await api.env.openBinaryReader(resolve(resolveWorkspace(), path), undefined, context));
      let bytes: Uint8Array;
      try {
        const { size } = getOrThrow(await reader.info(context));
        if (size < 1 || size > maxRecordingBytes) throw new Error('Choose a nonempty recording up to 32 MiB.');
        bytes = getOrThrow(await reader.read(0, size + 1, context));
        if (bytes.byteLength !== size) throw new Error('The recording changed while reading. Choose it again.');
      } finally { await reader.close(context); }
      signal.throwIfAborted();
      // Published @nimiplatform/sdk@0.24.0-rc.10 binds audio.transcribe scenario jobs
      // to the App's default AIConfig record (per-session configRef arrives in sdk 0.24.0-rc.11).
      void getConfigRef;
      const runtime = { ai: createNimiLocalAppRuntimeScenarioJobClient(ai) };
      const result = await runRuntimeSpeechTranscribe({ runtime, appId: 'ai.nimi.harness', surfaceId: 'harness.conversations',
        scenarioId: `${sessionId}-${api.taskId}`, audio: { type: 'bytes', bytes, mimeType }, signal,
        abortReason: 'Harness transcription stopped.' });
      signal.throwIfAborted();
      if (!result.ok) throw new Error(`${result.error.reasonCode}: ${result.message}`);
      return { output: [{ type: 'text', text: result.output.text }], details: { jobId: result.output.jobId, status: result.output.jobStatus } };
    },
  })] });
}
