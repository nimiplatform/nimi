import React, { useCallback, useState } from 'react';
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
  const [style, setStyle] = useState('');
  const [lastError, setLastError] = useState<unknown>(null);

  const hasActiveJob = activeJobs.size > 0;

  const handleGenerate = useCallback(async () => {
    if (!brief || !selectedMusicModelId || !selectedMusicConnectorId) {
      return;
    }

    setLastError(null);
    const runtime = getPlatformClient().runtime;
    const resolvedStyle = style || [brief.genre, brief.mood].filter(Boolean).join(', ');
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
    style,
  ]);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Generate</h2>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-400">Runtime Path</label>
          <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
            {selectedMusicConnectorId && selectedMusicModelId
              ? `${selectedMusicConnectorId} -> ${selectedMusicModelId}`
              : 'No ready music connector/model pair'}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-zinc-400">Style Tags</label>
          <input
            className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
            value={style}
            onChange={(event) => setStyle(event.target.value)}
            placeholder={brief ? [brief.genre, brief.mood].filter(Boolean).join(', ') : 'e.g. indie, dreamy, acoustic'}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-zinc-400">Duration (sec)</label>
            <input
              className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
              type="number"
              min={10}
              max={600}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
            />
          </div>
          <div className="flex items-end pb-0.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={instrumental}
                onChange={(event) => setInstrumental(event.target.checked)}
                className="rounded border-zinc-600 bg-zinc-900"
              />
              <span className="text-xs text-zinc-400">Instrumental</span>
            </label>
          </div>
        </div>
      </div>

      {!musicConnectorAvailable && (
        <p className="text-xs text-amber-400">
          No music connector/model pair is ready. Configure runtime music access before generating.
        </p>
      )}

      {lastError ? (
        <ErrorDisplay error={lastError} onDismiss={() => setLastError(null)} onRetry={handleGenerate} />
      ) : null}

      <button
        className="w-full px-4 py-2 text-sm font-medium bg-zinc-100 text-zinc-900 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleGenerate}
        disabled={!brief || hasActiveJob || !musicConnectorAvailable}
        type="button"
      >
        {hasActiveJob ? 'Generating...' : 'Generate Song'}
      </button>

      {activeJobs.size > 0 && (
        <div className="space-y-2">
          {Array.from(activeJobs.values()).map((job) => (
            <div key={job.jobId} className="p-2 rounded-md bg-zinc-900 border border-zinc-800 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">{job.progress || job.status}</span>
                <StatusBadge status={job.status} />
              </div>
              {job.error && <p className="text-red-400 mt-1">{job.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'text-amber-400',
    running: 'text-blue-400',
    completed: 'text-emerald-400',
    failed: 'text-red-400',
    timeout: 'text-orange-400',
    canceled: 'text-zinc-500',
  };
  return <span className={`text-xs font-medium ${colors[status] ?? 'text-zinc-500'}`}>{status}</span>;
}
