/**
 * Submit an asynchronous Scenario Job and read its typed result.
 *
 * `text-annotate` needs a saved `text.annotate` intent and the language's
 * pipeline in Nimi's model configuration. Job storage is bounded execution
 * state: save the result in App storage if the App needs to keep it.
 */

import type {
  NimiLocalAppClient,
  NimiLocalAppScenarioJob,
  NimiLocalAppTextAnnotationDocument,
} from '@nimiplatform/sdk';

const TERMINAL_STATUSES: ReadonlySet<NimiLocalAppScenarioJob['status']> = new Set([
  'completed',
  'failed',
  'canceled',
  'timeout',
]);

export async function annotateEnglish(
  client: NimiLocalAppClient,
  texts: readonly string[],
): Promise<readonly NimiLocalAppTextAnnotationDocument[]> {
  const submitted = await client.ai.scenarioJobs.submit({ type: 'text-annotate', language: 'en', texts });
  let job = submitted.job;
  if (!TERMINAL_STATUSES.has(job.status)) {
    const events = await client.ai.scenarioJobs.subscribe(job.jobId);
    try {
      for await (const event of events) {
        job = event.job;
        if (TERMINAL_STATUSES.has(job.status)) break;
      }
    } finally {
      await events.cancel();
    }
  }
  if (job.status !== 'completed' || !job.textAnnotation) {
    throw Object.assign(new Error(`text-annotate Job ${job.jobId} ended as ${job.status}.`), {
      reasonCode: job.reasonCode,
    });
  }
  return job.textAnnotation.documents;
}
