import React, { useCallback, useRef, useState } from 'react';
import { ScenarioJobStatus, buildMusicIterationExtensions, type MusicIterationMode } from '@nimiplatform/sdk/runtime';
import {
  copyArtifactBytesToArrayBuffer,
  scenarioJobStatusLabel,
  scenarioJobStatusToGenerationStatus,
  useRuntimeGenerationPanel,
} from '@nimiplatform/nimi-kit/features/generation/runtime';
import { RuntimeGenerationPanel } from '@nimiplatform/nimi-kit/features/generation/ui';
import { useAppStore, type SongTake } from '@renderer/app-shell/providers/app-store.js';
import { OtSegmentedControl, OtAccordionSection } from './ui-primitives.js';

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

  const iterationState = useRuntimeGenerationPanel({
    input: {
      mode,
      sourceKind,
      selectedTakeId,
      selectedTakeAudio,
      uploadedAudio,
    },
    resolveRequest: ({
      input: {
        mode: nextMode,
        sourceKind: nextSourceKind,
        selectedTakeAudio: nextSelectedTakeAudio,
        uploadedAudio: nextUploadedAudio,
      },
    }) => {
      let sourceAudioBase64 = '';
      let sourceMimeType = 'audio/mpeg';
      if (nextSourceKind === 'take') {
        if (!nextSelectedTakeAudio) {
          throw new Error('Select a take with audio before iterating.');
        }
        sourceAudioBase64 = arrayBufferToBase64(nextSelectedTakeAudio);
      } else {
        if (!nextUploadedAudio) {
          throw new Error('Upload source audio before iterating.');
        }
        sourceAudioBase64 = nextUploadedAudio.base64;
        sourceMimeType = nextUploadedAudio.mime;
      }

      const prompt = brief?.description || '';
      const style = brief ? [brief.genre, brief.mood].filter(Boolean).join(', ') : '';
      return {
        modal: 'music',
        input: {
          model: selectedMusicModelId || '',
          connectorId: selectedMusicConnectorId || '',
          prompt,
          lyrics: lyrics || undefined,
          style: style || undefined,
          title: brief?.title || 'Untitled',
          extensions: buildMusicIterationExtensions({
            mode: nextMode,
            sourceAudioBase64,
            sourceMimeType,
            trimStartSec: trimStart ?? undefined,
            trimEndSec: trimEnd ?? undefined,
          }),
        },
      };
    },
    disabled: !musicIterationSupported || !hasSource || hasActiveJob,
    submitting: hasActiveJob,
    onJobUpdate: ({ job }) => {
      setJobStatus(job.jobId, {
        jobId: job.jobId,
        status: scenarioJobStatusToGenerationStatus(job.status),
        progress: scenarioJobStatusLabel(job.status),
        error: job.reasonDetail || undefined,
      });
    },
    onCompleted: async (result) => {
      if (result.job.status !== ScenarioJobStatus.COMPLETED) {
        throw new Error(result.job.reasonDetail || scenarioJobStatusLabel(result.job.status));
      }

      const prompt = brief?.description || '';
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
    },
    onError: (error, context) => {
      if (context.result) {
        const failedJobId = context.result.job.jobId;
        setJobStatus(failedJobId, {
          jobId: failedJobId,
          status: scenarioJobStatusToGenerationStatus(context.result.job.status),
          progress: scenarioJobStatusLabel(context.result.job.status),
          error: error instanceof Error ? error.message : String(error),
        });
        window.setTimeout(() => removeJob(failedJobId), 2500);
        return;
      }
      const jobId = `iterate-${Date.now()}`;
      setJobStatus(jobId, {
        jobId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      window.setTimeout(() => removeJob(jobId), 2500);
    },
  });

  if (takes.length === 0) {
    return null;
  }

  return (
    <OtAccordionSection title="Iteration" defaultOpen={false}>
      <RuntimeGenerationPanel
        runtimeState={iterationState}
        title="Iteration"
        runtimeLabel="Runtime Path"
        runtimeValue={selectedMusicConnectorId && selectedMusicModelId
          ? `${selectedMusicConnectorId} → ${selectedMusicModelId}`
          : 'No ready music connector/model pair'}
        warning={!musicIterationSupported
          ? 'Iteration requires a connector/model pair that supports music.generate.iteration (e.g. Stability).'
          : null}
        controls={(
          <>
            <div className="space-y-1">
              <label className="text-[11px] text-[var(--nimi-text-muted)] uppercase tracking-[0.06em]">Mode</label>
              <OtSegmentedControl
                options={['extend', 'remix', 'reference'] as const}
                value={mode}
                onChange={setMode}
                labels={{ extend: 'Extend', remix: 'Remix', reference: 'Reference' }}
              />
            </div>

            <p className="text-[10px] text-[color-mix(in_srgb,var(--nimi-text-muted)_74%,transparent)]">
              {mode === 'extend' && 'Continue the selected source take.'}
              {mode === 'remix' && 'Keep the source material but reinterpret arrangement and style.'}
              {mode === 'reference' && 'Use the source as a guide for a fresh generation.'}
            </p>

            <div className="space-y-2">
              <label className="text-[11px] text-[var(--nimi-text-muted)] uppercase tracking-[0.06em]">Source</label>
              <OtSegmentedControl
                options={['take', 'upload'] as const}
                value={sourceKind}
                onChange={setSourceKind}
                labels={{ take: 'From Take', upload: 'Upload Audio' }}
              />

              {sourceKind === 'take' && (
                <div className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-surface-card)_74%,var(--nimi-action-primary-bg)_26%)] bg-[var(--nimi-surface-card)] p-2.5 text-xs">
                  {selectedTake ? (
                    <div className="flex items-center justify-between">
                      <span className="truncate text-[var(--nimi-text-secondary)]">{selectedTake.title}</span>
                      <span className={selectedTakeAudio ? 'text-[var(--nimi-status-success)]' : 'text-[color-mix(in_srgb,var(--nimi-text-muted)_74%,transparent)]'}>
                        {selectedTakeAudio ? 'ready' : 'no audio'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[color-mix(in_srgb,var(--nimi-text-muted)_74%,transparent)]">Select a take from the list.</span>
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
                    className="w-full rounded-lg border border-dashed border-[color-mix(in_srgb,var(--nimi-surface-card)_74%,var(--nimi-action-primary-bg)_26%)] bg-[var(--nimi-surface-card)] p-3 text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_74%,transparent)] transition-colors hover:border-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_5%,transparent)]"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    {uploadedAudio ? uploadedAudio.name : 'Drop audio or click to browse'}
                  </button>
                </div>
              )}
            </div>

            {(trimStart !== null || trimEnd !== null) && (
              <p className="text-[10px] font-mono tabular-nums text-[color-mix(in_srgb,var(--nimi-action-primary-bg-hover)_78%,white)]">
                Trim: {trimStart !== null ? `${trimStart.toFixed(1)}s` : 'start'} – {trimEnd !== null ? `${trimEnd.toFixed(1)}s` : 'end'}
              </p>
            )}
          </>
        )}
        submitLabel={`${mode.charAt(0).toUpperCase() + mode.slice(1)} Song`}
        submittingLabel="Processing..."
      />
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
