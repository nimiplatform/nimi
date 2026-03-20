import React, { useCallback, useRef, useState } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import { ScenarioJobStatus, buildMusicIterationExtensions, type MusicIterationMode } from '@nimiplatform/sdk/runtime';
import { useAppStore, type SongTake } from '@renderer/app-shell/providers/app-store.js';
import {
  copyArtifactBytesToArrayBuffer,
  scenarioJobStatusLabel,
  scenarioJobStatusToGenerationStatus,
  submitMusicJobAndWait,
} from './runtime-workflow.js';
import { ErrorDisplay } from './error-display.js';
import { OtButton, OtSegmentedControl, OtAccordionSection } from './ui-primitives.js';

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

    const runtime = getPlatformClient().runtime;
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
    <OtAccordionSection title="Iteration" defaultOpen={false}>
      {!musicIterationSupported && (
        <div className="rounded-lg border border-ot-warning/20 bg-ot-warning/10 px-3 py-2 text-xs text-ot-warning">
          Iteration requires a connector/model pair that supports music.generate.iteration (e.g. Suno, Stability).
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">Mode</label>
          <OtSegmentedControl
            options={['extend', 'remix', 'reference'] as const}
            value={mode}
            onChange={setMode}
            labels={{ extend: 'Extend', remix: 'Remix', reference: 'Reference' }}
          />
        </div>

        <p className="text-[10px] text-ot-text-ghost">
          {mode === 'extend' && 'Continue the selected source take.'}
          {mode === 'remix' && 'Keep the source material but reinterpret arrangement and style.'}
          {mode === 'reference' && 'Use the source as a guide for a fresh generation.'}
        </p>

        <div className="space-y-2">
          <label className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">Source</label>
          <OtSegmentedControl
            options={['take', 'upload'] as const}
            value={sourceKind}
            onChange={setSourceKind}
            labels={{ take: 'From Take', upload: 'Upload Audio' }}
          />

          {sourceKind === 'take' && (
            <div className="p-2.5 rounded-lg bg-ot-surface-3 border border-ot-surface-5 text-xs">
              {selectedTake ? (
                <div className="flex items-center justify-between">
                  <span className="text-ot-text-secondary truncate">{selectedTake.title}</span>
                  <span className={selectedTakeAudio ? 'text-ot-success' : 'text-ot-text-ghost'}>
                    {selectedTakeAudio ? 'ready' : 'no audio'}
                  </span>
                </div>
              ) : (
                <span className="text-ot-text-ghost">Select a take from the list.</span>
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
                className="w-full p-3 rounded-lg bg-ot-surface-3 border border-dashed border-ot-surface-5 text-xs text-ot-text-ghost hover:border-ot-violet-400 hover:bg-ot-violet-400/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                {uploadedAudio ? uploadedAudio.name : 'Drop audio or click to browse'}
              </button>
            </div>
          )}
        </div>

        {(trimStart !== null || trimEnd !== null) && (
          <p className="text-[10px] font-mono text-ot-violet-300 tabular-nums">
            Trim: {trimStart !== null ? `${trimStart.toFixed(1)}s` : 'start'} – {trimEnd !== null ? `${trimEnd.toFixed(1)}s` : 'end'}
          </p>
        )}

        {lastError ? (
          <ErrorDisplay error={lastError} onDismiss={() => setLastError(null)} onRetry={handleIterate} />
        ) : null}

        <OtButton
          variant="secondary"
          className="w-full"
          onClick={handleIterate}
          disabled={!musicIterationSupported || !hasSource || hasActiveJob}
          loading={hasActiveJob}
          type="button"
        >
          {hasActiveJob ? 'Processing...' : `${mode.charAt(0).toUpperCase() + mode.slice(1)} Song`}
        </OtButton>
      </div>
    </OtAccordionSection>
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
