import { ScenarioJobStatus, type Runtime } from '@nimiplatform/sdk/runtime';
import type { MusicGenerateInput, TextStreamOutput } from '@nimiplatform/sdk/runtime';
import type { ScenarioArtifact, ScenarioJob } from '@nimiplatform/sdk/runtime/generated/runtime/v1/ai.js';
import type { GenerationJob } from '@renderer/app-shell/providers/app-store.js';

export function scenarioJobStatusToGenerationStatus(
  status: ScenarioJobStatus,
): GenerationJob['status'] {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
    case ScenarioJobStatus.QUEUED:
      return 'pending';
    case ScenarioJobStatus.RUNNING:
      return 'running';
    case ScenarioJobStatus.COMPLETED:
      return 'completed';
    case ScenarioJobStatus.TIMEOUT:
      return 'timeout';
    case ScenarioJobStatus.CANCELED:
      return 'canceled';
    case ScenarioJobStatus.FAILED:
    default:
      return 'failed';
  }
}

export function scenarioJobStatusLabel(status: ScenarioJobStatus): string {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'Submitted to runtime';
    case ScenarioJobStatus.QUEUED:
      return 'Queued by runtime';
    case ScenarioJobStatus.RUNNING:
      return 'Generating audio';
    case ScenarioJobStatus.COMPLETED:
      return 'Completed';
    case ScenarioJobStatus.TIMEOUT:
      return 'Timed out';
    case ScenarioJobStatus.CANCELED:
      return 'Canceled';
    case ScenarioJobStatus.FAILED:
    default:
      return 'Failed';
  }
}

export async function submitMusicJobAndWait(
  runtime: Runtime,
  input: MusicGenerateInput,
  onUpdate: (job: ScenarioJob) => void,
): Promise<{ job: ScenarioJob; artifacts: ScenarioArtifact[] }> {
  const submitted = await runtime.media.jobs.submit({
    modal: 'music',
    input,
  });
  onUpdate(submitted);

  const events = await runtime.media.jobs.subscribe(submitted.jobId);
  let terminalJob = submitted;
  for await (const event of events) {
    if (!event.job) {
      continue;
    }
    terminalJob = event.job;
    onUpdate(event.job);
    if (isTerminalScenarioJobStatus(event.job.status)) {
      break;
    }
  }

  if (!isTerminalScenarioJobStatus(terminalJob.status)) {
    terminalJob = await runtime.media.jobs.get(submitted.jobId);
    onUpdate(terminalJob);
  }

  const artifacts = await runtime.media.jobs.getArtifacts(submitted.jobId);
  return {
    job: terminalJob,
    artifacts: artifacts.artifacts,
  };
}

export async function collectTextStream(output: TextStreamOutput): Promise<string> {
  let text = '';
  for await (const part of output.stream) {
    if (part.type === 'delta') {
      text += part.text;
      continue;
    }
    if (part.type === 'error') {
      throw part.error;
    }
  }
  return text;
}

export function copyArtifactBytesToArrayBuffer(bytes: Uint8Array | undefined): ArrayBuffer | null {
  if (!bytes || bytes.byteLength === 0) {
    return null;
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function isTerminalScenarioJobStatus(status: ScenarioJobStatus): boolean {
  return status === ScenarioJobStatus.COMPLETED
    || status === ScenarioJobStatus.FAILED
    || status === ScenarioJobStatus.CANCELED
    || status === ScenarioJobStatus.TIMEOUT;
}
