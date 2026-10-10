/**
 * Submit once, then observe the original Job with Get.
 *
 * `text-annotate` needs saved `text.annotate` intent and the language's selected
 * Loadout. Persist the Job ID on submission and adopt complete results into App
 * storage before Runtime retention expires. Events are optional update hints;
 * they do not replace Get or drive native asynchronous provider reconciliation.
 */

import type {
  NimiLocalAppClient,
  NimiLocalAppScenarioJob,
  NimiLocalAppTextAnnotationDocument,
} from '@nimiplatform/sdk';

const TERMINAL_STATUSES: ReadonlySet<NimiLocalAppScenarioJob['status']> = new Set([
  'completed', 'failed', 'canceled', 'timeout',
]);

export async function annotateEnglish(
  client: NimiLocalAppClient,
  texts: readonly string[],
  onSubmitted: (jobId: string) => void | Promise<void>,
  observationSignal?: AbortSignal,
): Promise<readonly NimiLocalAppTextAnnotationDocument[]> {
  observationSignal?.throwIfAborted();
  const { job } = await client.ai.scenarioJobs.submit({ type: 'text-annotate', language: 'en', texts });
  try {
    await onSubmitted(job.jobId);
    return await readEnglishAnnotation(client, job.jobId, observationSignal);
  } catch (cause) {
    throw Object.assign(new Error(`Observe the original Job ${job.jobId}; do not submit again.`, { cause }), {
      jobId: job.jobId,
    });
  }
}

/** Resume observation after reopening the App; never submits or cancels work. */
export async function readEnglishAnnotation(
  client: NimiLocalAppClient,
  jobId: string,
  observationSignal?: AbortSignal,
): Promise<readonly NimiLocalAppTextAnnotationDocument[]> {
  for (;;) {
    observationSignal?.throwIfAborted();
    const response = await client.ai.scenarioJobs.get(jobId);
    observationSignal?.throwIfAborted();
    if (response.observationIssue) {
      // This is an observation problem, not a fabricated failed Job.
      throw Object.assign(new Error(`Could not refresh Job ${jobId}.`), {
        jobId, observationIssue: response.observationIssue,
      });
    }
    const { job } = response;
    if (TERMINAL_STATUSES.has(job.status)) {
      if (job.status !== 'completed' || job.scenarioType !== 'text-annotate' || !job.textAnnotation) {
        throw Object.assign(new Error(`text-annotate Job ${jobId} ended as ${job.status}.`), {
          jobId, reasonCode: job.reasonCode,
        });
      }
      return job.textAnnotation.documents;
    }
    // The App owns cadence. Aborting observation never sends execution Cancel.
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  }
}
