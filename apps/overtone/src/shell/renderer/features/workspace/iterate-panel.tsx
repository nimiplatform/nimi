import React, { useCallback, useRef, useState } from 'react';
import { ScenarioJobStatus, buildMusicIterationExtensions, type MusicIterationMode } from '@nimiplatform/sdk/runtime';
import { useAppStore, type SongTake } from '@renderer/app-shell/providers/app-store.js';
import { getRuntimeInstance } from '@renderer/bridge/runtime-sdk.js';
import {
  copyArtifactBytesToArrayBuffer,
  scenarioJobStatusLabel,
  scenarioJobStatusToGenerationStatus,
  submitMusicJobAndWait,
} from './runtime-workflow.js';
import { ErrorDisplay } from './error-display.js';

type SourceKind = 'take' | 'upload';

export function IteratePanel() {
  const brief = useAppStore((state) => state.brief);
  const lyrics = useAppStore((state) => state.lyrics);
  const takes = useAppStore((state) => state.takes);
  const selectedTakeId = useAppStore((state) => state.selectedTakeId);
  const audioBuffers = useAppStore((state) => state.audioBuffers);
  const addTake = useAppStore((state) => state.addTake);
  const setJobStatus = useAppStore((state) => state.setJobStatus);
  const removeJob = useAppStore((state) => state.removeJob);
  const setAudioBuffer = useAppStore((state) => state.setAudioBuffer);
  const activeJobs = useAppStore((state) => state.activeJobs);
  const selectedMusicConnectorId = useAppStore((state) => state.selectedMusicConnectorId);
  const selectedMusicModelId = useAppStore((state) => state.selectedMusicModelId);
  const musicIterationSupported = useAppStore((state) => state.musicIterationSupported);
  const trimStart = useAppStore((state) => state.trimStart);
  const trimEnd = useAppStore((state) => state.trimEnd);

  const [mode, setMode] = useState<MusicIterationMode>('extend');
  const [sourceKind, setSourceKind] = useState<SourceKind>('take');
  const [uploadedAudio, setUploadedAudio] = useState<{ base64: string; mime: string; name: string } | null>(null);
  const [lastError, setLastError] = useState<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasActiveJob = activeJobs.size > 0;
  const selectedTake = takes.find((take) => take.takeId === selectedTakeId);
  const selectedTakeAudio = selectedTakeId ? audioBuffers.get(selectedTakeId) : undefined;

  const hasSource = sourceKind === 'take'
    ? Boolean(selectedTake && selectedTakeAudio)
    : Boolean(uploadedAudio);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (!(value instanceof ArrayBuffer)) {
        return;
      }
      setUploadedAudio({
        base64: arrayBufferToBase64(value),
        mime: file.type || 'audio/mpeg',
        name: file.name,
      });
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleIterate = useCallback(async () => {
    if (!selectedMusicModelId || !selectedMusicConnectorId) {
      return;
    }

    setLastError(null);
    let sourceAudioBase64 = '';
    let sourceMimeType = 'audio/mpeg';
    if (sourceKind === 'take') {
      if (!selectedTakeAudio) {
        return;
      }
      sourceAudioBase64 = arrayBufferToBase64(selectedTakeAudio);
    } else {
      if (!uploadedAudio) {
        return;
      }
      sourceAudioBase64 = uploadedAudio.base64;
      sourceMimeType = uploadedAudio.mime;
    }

    const runtime = getRuntimeInstance();
    const prompt = brief?.description || '';
    const style = brief ? [brief.genre, brief.mood].filter(Boolean).join(', ') : '';
    let result:
      | Awaited<ReturnType<typeof submitMusicJobAndWait>>
      | undefined;

    try {
      result = await submitMusicJobAndWait(runtime, {
        model: selectedMusicModelId,
        connectorId: selectedMusicConnectorId,
        prompt,
        lyrics: lyrics || undefined,
        style: style || undefined,
        title: brief?.title || 'Untitled',
        extensions: buildMusicIterationExtensions({
          mode,
          sourceAudioBase64,
          sourceMimeType,
          trimStartSec: trimStart ?? undefined,
          trimEndSec: trimEnd ?? undefined,
        }),
      }, (job) => {
        setJobStatus(job.jobId, {
          jobId: job.jobId,
          status: scenarioJobStatusToGenerationStatus(job.status),
          progress: scenarioJobStatusLabel(job.status),
          error: job.reasonDetail || undefined,
        });
      });

      if (result.job.status !== ScenarioJobStatus.COMPLETED) {
        throw new Error(result.job.reasonDetail || scenarioJobStatusLabel(result.job.status));
      }

      const takeId = `take-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const origin: SongTake['origin'] = mode;
      const take: SongTake = {
        takeId,
        parentTakeId: sourceKind === 'take' ? selectedTakeId ?? undefined : undefined,
        origin,
        title: `${brief?.title || 'Untitled'} - ${mode} ${Date.now() % 1000}`,
        jobId: result.job.jobId,
        artifactId: result.artifacts[0]?.artifactId,
        promptSnapshot: prompt,
        lyricsSnapshot: lyrics || undefined,
        createdAt: Date.now(),
      };

      const buffer = copyArtifactBytesToArrayBuffer(result.artifacts[0]?.bytes);
      if (buffer) {
        setAudioBuffer(takeId, buffer);
      }
      addTake(take);
      const completedJobId = result.job.jobId;
      setJobStatus(completedJobId, {
        jobId: completedJobId,
        status: 'completed',
        progress: 'Completed',
      });
      window.setTimeout(() => removeJob(completedJobId), 1500);
    } catch (error: unknown) {
      setLastError(error);
      if (result) {
        const failedJobId = result.job.jobId;
        setJobStatus(failedJobId, {
          jobId: failedJobId,
          status: scenarioJobStatusToGenerationStatus(result.job.status),
          progress: scenarioJobStatusLabel(result.job.status),
          error: error instanceof Error ? error.message : String(error),
        });
        window.setTimeout(() => removeJob(failedJobId), 2500);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      const jobId = `iterate-${Date.now()}`;
      setJobStatus(jobId, {
        jobId,
        status: 'failed',
        error: message,
      });
      window.setTimeout(() => removeJob(jobId), 2500);
    }
  }, [
    addTake,
    brief,
    lyrics,
    mode,
    removeJob,
    selectedMusicConnectorId,
    selectedMusicModelId,
    selectedTakeAudio,
    selectedTakeId,
    setAudioBuffer,
    setJobStatus,
    sourceKind,
    trimEnd,
    trimStart,
    uploadedAudio,
  ]);

  if (takes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Iterate</h2>

      {!musicIterationSupported && (
        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Iteration requires a connector/model pair that supports music.generate.iteration (e.g. Suno, Stability).
        </div>
      )}

      <div className="flex gap-1">
        {(['extend', 'remix', 'reference'] as const).map((value) => (
          <button
            key={value}
            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              mode === value
                ? 'bg-zinc-700 text-zinc-100'
                : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'
            }`}
            onClick={() => setMode(value)}
            type="button"
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-zinc-600">
        {mode === 'extend' && 'Continue the selected source take.'}
        {mode === 'remix' && 'Keep the source material but reinterpret arrangement and style.'}
        {mode === 'reference' && 'Use the source as a guide for a fresh generation.'}
      </p>

      <div className="space-y-2">
        <label className="text-xs font-medium text-zinc-400">Source</label>
        <div className="flex gap-2">
          <button
            className={`flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors ${
              sourceKind === 'take'
                ? 'border-zinc-600 bg-zinc-800 text-zinc-200'
                : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700'
            }`}
            onClick={() => setSourceKind('take')}
            type="button"
          >
            From Take
          </button>
          <button
            className={`flex-1 px-2 py-1.5 text-xs rounded-md border transition-colors ${
              sourceKind === 'upload'
                ? 'border-zinc-600 bg-zinc-800 text-zinc-200'
                : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:border-zinc-700'
            }`}
            onClick={() => setSourceKind('upload')}
            type="button"
          >
            Upload Audio
          </button>
        </div>

        {sourceKind === 'take' && (
          <div className="p-2 rounded-md bg-zinc-900 border border-zinc-800 text-xs">
            {selectedTake ? (
              <div className="flex items-center justify-between">
                <span className="text-zinc-300 truncate">{selectedTake.title}</span>
                <span className={selectedTakeAudio ? 'text-emerald-400' : 'text-zinc-600'}>
                  {selectedTakeAudio ? 'ready' : 'no audio'}
                </span>
              </div>
            ) : (
              <span className="text-zinc-600">Select a take from the list.</span>
            )}
          </div>
        )}

        {sourceKind === 'upload' && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              className="w-full p-2 rounded-md bg-zinc-900 border border-dashed border-zinc-700 text-xs text-zinc-500 hover:border-zinc-600 hover:text-zinc-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              {uploadedAudio ? uploadedAudio.name : 'Click to upload an audio source'}
            </button>
          </div>
        )}
      </div>

      {(trimStart !== null || trimEnd !== null) && (
        <p className="text-[10px] text-cyan-400 tabular-nums">
          Trim: {trimStart !== null ? `${trimStart.toFixed(1)}s` : 'start'} – {trimEnd !== null ? `${trimEnd.toFixed(1)}s` : 'end'}
        </p>
      )}

      {lastError ? (
        <ErrorDisplay error={lastError} onDismiss={() => setLastError(null)} onRetry={handleIterate} />
      ) : null}

      <button
        className="w-full px-4 py-2 text-sm font-medium bg-zinc-100 text-zinc-900 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleIterate}
        disabled={!musicIterationSupported || !hasSource || hasActiveJob}
        type="button"
      >
        {hasActiveJob ? 'Processing...' : `${mode.charAt(0).toUpperCase() + mode.slice(1)} Song`}
      </button>
    </div>
  );
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}
