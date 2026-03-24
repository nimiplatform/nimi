import { useState } from 'react';
import { ScenarioJobStatus } from '@nimiplatform/sdk/runtime';
import {
  copyArtifactBytesToArrayBuffer,
  scenarioJobStatusLabel,
  scenarioJobStatusToGenerationStatus,
  useRuntimeGenerationPanel,
} from '@nimiplatform/nimi-kit/features/generation/runtime';
import {
  RuntimeGenerationPanel,
} from '@nimiplatform/nimi-kit/features/generation/ui';
import { useAppStore, type SongTake } from '@renderer/app-shell/providers/app-store.js';
import { OtInput, OtToggle, OtTagInput, OtAccordionSection } from './ui-primitives.js';

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

  const hasActiveJob = activeJobs.size > 0;

  const generationState = useRuntimeGenerationPanel({
    input: {
      durationSeconds,
      instrumental,
      styleTags,
    },
    resolveRequest: ({
      input: {
        durationSeconds: nextDurationSeconds,
        instrumental: nextInstrumental,
        styleTags: nextStyleTags,
      },
    }) => {
      const resolvedStyle = nextStyleTags.length > 0
        ? nextStyleTags.join(', ')
        : [brief?.genre, brief?.mood].filter(Boolean).join(', ');
      return {
        modal: 'music',
        input: {
          model: selectedMusicModelId || '',
          connectorId: selectedMusicConnectorId || '',
          prompt: brief?.description || '',
          lyrics: lyrics || undefined,
          style: resolvedStyle || undefined,
          title: brief?.title || '',
          durationSeconds: nextDurationSeconds,
          instrumental: nextInstrumental,
        },
      };
    },
    disabled: !brief || hasActiveJob || !musicConnectorAvailable,
    submitting: hasActiveJob,
    triggerEventName: 'ot-trigger-generate',
    canTriggerShortcut: Boolean(brief && !hasActiveJob && musicConnectorAvailable),
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

      const takeId = `take-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const take: SongTake = {
        takeId,
        origin: 'prompt',
        title: `${brief?.title || 'Untitled'} - Take ${Date.now() % 1000}`,
        jobId: result.job.jobId,
        artifactId: result.artifacts[0]?.artifactId,
        promptSnapshot: brief?.description || '',
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

      const jobId = `generate-${Date.now()}`;
      setJobStatus(jobId, {
        jobId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      window.setTimeout(() => removeJob(jobId), 2500);
    },
  });

  return (
    <OtAccordionSection title="Generation Controls" defaultOpen>
      <RuntimeGenerationPanel
        runtimeState={generationState}
        title="Generation Controls"
        runtimeLabel="Runtime Path"
        runtimeValue={selectedMusicConnectorId && selectedMusicModelId
          ? `${selectedMusicConnectorId} → ${selectedMusicModelId}`
          : 'No ready music connector/model pair'}
        warning={!musicConnectorAvailable
          ? 'No music connector/model pair is ready. Configure runtime music access before generating.'
          : null}
        controls={(
          <>
            <div className="space-y-1">
              <label className="text-[11px] text-[var(--nimi-text-muted)] uppercase tracking-[0.06em]">Style Tags</label>
              <OtTagInput
                tags={styleTags}
                onChange={setStyleTags}
                placeholder={brief ? [brief.genre, brief.mood].filter(Boolean).join(', ') : 'e.g. indie, dreamy, acoustic'}
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-[11px] text-[var(--nimi-text-muted)] uppercase tracking-[0.06em]">Duration (sec)</label>
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
          </>
        )}
        submitLabel="Generate Song"
        submittingLabel="Generating..."
      />
    </OtAccordionSection>
  );
}
