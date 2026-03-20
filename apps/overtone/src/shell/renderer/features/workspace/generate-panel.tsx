import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformClient } from '@nimiplatform/sdk';
import { ScenarioJobStatus } from '@nimiplatform/sdk/runtime';
import { useAppStore, type SongTake } from '@renderer/app-shell/providers/app-store.js';
import {
  copyArtifactBytesToArrayBuffer,
  scenarioJobStatusLabel,
  scenarioJobStatusToGenerationStatus,
  submitMusicJobAndWait,
} from './runtime-workflow.js';
import { ErrorDisplay } from './error-display.js';
import { OtButton, OtInput, OtToggle, OtTagInput, OtAccordionSection, OtProgressBar } from './ui-primitives.js';

export function GeneratePanel() {
  const brief = useAppStore((state) => state.brief);
  const lyrics = useAppStore((state) => state.lyrics);
  const addTake = useAppStore((state) => state.addTake);
  const setJobStatus = useAppStore((state) => state.setJobStatus);
  const removeJob = useAppStore((state) => state.removeJob);
  const setAudioBuffer = useAppStore((state) => state.setAudioBuffer);
  const activeJobs = useAppStore((state) => state.activeJobs);
  const musicConnectorAvailable = useAppStore((state) => state.musicConnectorAvailable);
  const selectedMusicConnectorId = useAppStore((state) => state.selectedMusicConnectorId);
  const selectedMusicModelId = useAppStore((state) => state.selectedMusicModelId);

  const [durationSeconds, setDurationSeconds] = useState(120);
  const [instrumental, setInstrumental] = useState(false);
  const [styleTags, setStyleTags] = useState<string[]>([]);
  const [lastError, setLastError] = useState<unknown>(null);

  const hasActiveJob = activeJobs.size > 0;

  const handleGenerate = useCallback(async () => {
    if (!brief || !selectedMusicModelId || !selectedMusicConnectorId) {
      return;
    }

    setLastError(null);
    const runtime = getPlatformClient().runtime;
    const resolvedStyle = styleTags.length > 0
      ? styleTags.join(', ')
      : [brief.genre, brief.mood].filter(Boolean).join(', ');
    let result:
      | Awaited<ReturnType<typeof submitMusicJobAndWait>>
      | undefined;
    try {
      result = await submitMusicJobAndWait(runtime, {
        model: selectedMusicModelId,
        connectorId: selectedMusicConnectorId,
        prompt: brief.description,
        lyrics: lyrics || undefined,
        style: resolvedStyle || undefined,
        title: brief.title,
        durationSeconds,
        instrumental,
      }, (nextJob) => {
        setJobStatus(nextJob.jobId, {
          jobId: nextJob.jobId,
          status: scenarioJobStatusToGenerationStatus(nextJob.status),
          progress: scenarioJobStatusLabel(nextJob.status),
          error: nextJob.reasonDetail || undefined,
        });
      });

      if (result.job.status !== ScenarioJobStatus.COMPLETED) {
        throw new Error(result.job.reasonDetail || scenarioJobStatusLabel(result.job.status));
      }

      const takeId = `take-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const take: SongTake = {
        takeId,
        origin: 'prompt',
        title: `${brief.title || 'Untitled'} - Take ${Date.now() % 1000}`,
        jobId: result.job.jobId,
        artifactId: result.artifacts[0]?.artifactId,
        promptSnapshot: brief.description,
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
      const jobId = `generate-${Date.now()}`;
      setJobStatus(jobId, {
        jobId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      window.setTimeout(() => removeJob(jobId), 2500);
    }
  }, [
    addTake,
    brief,
    durationSeconds,
    instrumental,
    lyrics,
    removeJob,
    selectedMusicConnectorId,
    selectedMusicModelId,
    setAudioBuffer,
    setJobStatus,
    styleTags,
  ]);

  // Listen for ⌘G shortcut from workspace-page
  useEffect(() => {
    const onTrigger = () => {
      if (brief && !hasActiveJob && musicConnectorAvailable) {
        void handleGenerate();
      }
    };
    window.addEventListener('ot-trigger-generate', onTrigger);
    return () => window.removeEventListener('ot-trigger-generate', onTrigger);
  }, [brief, hasActiveJob, musicConnectorAvailable, handleGenerate]);

  return (
    <OtAccordionSection title="Generation Controls" defaultOpen>
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">Runtime Path</label>
          <div className="rounded-lg bg-ot-surface-4 border border-ot-surface-5 px-3 py-2 text-sm text-ot-text-secondary">
            {selectedMusicConnectorId && selectedMusicModelId
              ? `${selectedMusicConnectorId} → ${selectedMusicModelId}`
              : 'No ready music connector/model pair'}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">Style Tags</label>
          <OtTagInput
            tags={styleTags}
            onChange={setStyleTags}
            placeholder={brief ? [brief.genre, brief.mood].filter(Boolean).join(', ') : 'e.g. indie, dreamy, acoustic'}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-[11px] text-ot-text-tertiary uppercase tracking-[0.06em]">Duration (sec)</label>
            <OtInput
              type="number"
              min={10}
              max={600}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
            />
          </div>
          <div className="flex items-end pb-1">
            <OtToggle
              checked={instrumental}
              onChange={setInstrumental}
              label="Instrumental"
            />
          </div>
        </div>
      </div>

      {!musicConnectorAvailable && (
        <p className="text-xs text-ot-warning mt-3">
          No music connector/model pair is ready. Configure runtime music access before generating.
        </p>
      )}

      {lastError ? (
        <div className="mt-3">
          <ErrorDisplay error={lastError} onDismiss={() => setLastError(null)} onRetry={handleGenerate} />
        </div>
      ) : null}

      <OtButton
        variant="primary"
        className={`w-full mt-4${hasActiveJob ? ' ot-btn-primary--generating' : ''}`}
        onClick={handleGenerate}
        disabled={!brief || hasActiveJob || !musicConnectorAvailable}
        loading={hasActiveJob}
        type="button"
      >
        {hasActiveJob ? 'Generating...' : 'Generate Song'}
      </OtButton>

      {activeJobs.size > 0 && (
        <div className="space-y-2 mt-3">
          {Array.from(activeJobs.values()).map((job) => (
            <div key={job.jobId} className="p-2 rounded-lg bg-ot-surface-3 border border-ot-surface-5 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-ot-text-secondary">{job.progress || job.status}</span>
                <StatusBadge status={job.status} />
              </div>
              {job.status === 'running' && <OtProgressBar generating value={50} />}
              {job.error && <p className="text-ot-error">{job.error}</p>}
            </div>
          ))}
        </div>
      )}
    </OtAccordionSection>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'text-ot-warning',
    running: 'text-ot-info',
    completed: 'text-ot-success',
    failed: 'text-ot-error',
    timeout: 'text-ot-warning',
    canceled: 'text-ot-text-tertiary',
  };
  return <span className={`text-xs font-medium ${colors[status] ?? 'text-ot-text-tertiary'}`}>{status}</span>;
}
