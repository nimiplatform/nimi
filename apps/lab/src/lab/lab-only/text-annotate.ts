import {
  LOCAL_ONLY_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';
import type { StudioCapabilityRuntimeContext } from '../../ai-studio-core/runtime.js';
import type { StudioCapabilityRunResult } from '../../ai-studio-core/runtime-types.js';
import {
  STUDIO_TEXT_ANNOTATION_DOCUMENT_MEDIA_TYPE,
  encodeStudioTextAnnotationDocument,
  studioDocumentSha256,
} from '../../ai-studio-core/text-annotation-document.js';
import { labJobNonSuccess, observeLabScenarioJob } from './lab-scenario-job.js';

export type LabTextAnnotateParameters = {
  language?: string;
  documents?: string[];
};

export const LAB_TEXT_ANNOTATE_DOCUMENT_PREFIX = 'studio/text-annotate';

export const labTextAnnotateParameters = defineStudioParameters<LabTextAnnotateParameters>({
  initial: () => ({ language: 'en' }),
  routeMatrix: {
    language: LOCAL_ONLY_STUDIO_PARAMETER,
    documents: LOCAL_ONLY_STUDIO_PARAMETER,
  },
  summarize: (parameters) => ({
    ...(parameters.language ? { language: parameters.language } : {}),
    ...(labTextAnnotateDocuments(parameters).length ? { additionalDocuments: labTextAnnotateDocuments(parameters).length } : {}),
  }),
  hasAlternativeInput: (parameters) => labTextAnnotateDocuments(parameters).length > 0,
});

export function labTextAnnotateDocuments(parameters: LabTextAnnotateParameters | undefined): string[] {
  return (parameters?.documents ?? []).filter((value) => value.trim().length > 0);
}

export async function runLabTextAnnotate(context: StudioCapabilityRuntimeContext): Promise<StudioCapabilityRunResult> {
  const { host, capability } = context;
  const parameters = context.input.parameters as LabTextAnnotateParameters | undefined;
  const language = (parameters?.language ?? '').trim();
  // The composer text is the first document and each additional document is
  // sent exactly as entered; offsets are counted over that text.
  const texts = [
    ...(context.input.prompt.trim() ? [context.input.prompt] : []),
    ...labTextAnnotateDocuments(parameters),
  ];
  if (!/^[a-z-]{2,16}$/u.test(language) || texts.length === 0 || texts.length > 64) {
    return host.nonSuccess(capability, 'input-invalid', host.translate('CapabilityTests.textAnnotate.inputInvalid'));
  }
  if (context.input.signal?.aborted) {
    return host.nonSuccess(capability, 'operation-aborted', host.translate('CapabilityTests.common.stoppedBeforeSubmit'));
  }
  const { job } = await host.client.ai.scenarioJobs.submit({ type: 'text-annotate', language, texts });
  const outcome = await observeLabScenarioJob({
    scenarioJobs: host.client.ai.scenarioJobs,
    jobId: job.jobId,
    capability,
    nonSuccess: host.nonSuccess,
    cancelReason: host.abortReason,
    ...(context.input.signal ? { signal: context.input.signal } : {}),
  });
  if (outcome.kind === 'non-success') return outcome.result;
  const completed = outcome.job;
  const annotation = completed.textAnnotation;
  const jobRef = { capability, nonSuccess: host.nonSuccess, jobId: completed.jobId };
  if (!annotation) {
    return labJobNonSuccess(jobRef, 'runtime-call-failed', host.translate('CapabilityTests.textAnnotate.resultMissing'), completed).result;
  }
  // The SDK already checked every span against each returned document; the
  // App also requires those documents to be exactly the ones it submitted.
  if (annotation.documents.length !== texts.length || annotation.documents.some((document, index) => document.text !== texts[index])) {
    return labJobNonSuccess(jobRef, 'runtime-call-failed', host.translate('CapabilityTests.textAnnotate.resultMismatch'), completed).result;
  }
  const bytes = encodeStudioTextAnnotationDocument(annotation);
  const sha256 = await studioDocumentSha256(bytes);
  const relativePath = `${LAB_TEXT_ANNOTATE_DOCUMENT_PREFIX}/${await jobToken(completed.jobId)}.json`;
  let saved;
  try {
    saved = await host.client.storage.assets.write({
      relativePath, body: bytes, mediaType: STUDIO_TEXT_ANNOTATION_DOCUMENT_MEDIA_TYPE, overwrite: false,
    });
  } catch (error) {
    return labJobNonSuccess(jobRef, 'runtime-call-failed', host.translate('CapabilityTests.textAnnotate.saveFailed', {
      detail: error instanceof Error ? error.message : String(error),
    }), completed).result;
  }
  if (saved.sha256 !== sha256 || saved.sizeBytes !== bytes.byteLength) {
    await host.client.storage.assets.remove(saved.relativePath).catch(() => undefined);
    return labJobNonSuccess(jobRef, 'runtime-call-failed', host.translate('CapabilityTests.textAnnotate.saveMismatch'), completed).result;
  }
  const tokenCount = annotation.documents.reduce((sum, document) => sum + document.tokens.length, 0);
  const sentenceCount = annotation.documents.reduce((sum, document) => sum + document.sentences.length, 0);
  return {
    ok: true,
    capabilityId: capability.id,
    capabilityLabel: capability.label,
    message: host.translate('CapabilityTests.textAnnotate.completed', { documents: annotation.documents.length, tokens: tokenCount }),
    output: {
      kind: 'text-annotation',
      jobId: completed.jobId,
      jobState: completed.status,
      language: annotation.documents[0]?.language ?? language,
      documentCount: annotation.documents.length,
      tokenCount,
      sentenceCount,
      document: {
        relativePath: saved.relativePath,
        mediaType: STUDIO_TEXT_ANNOTATION_DOCUMENT_MEDIA_TYPE,
        sizeBytes: saved.sizeBytes,
        sha256: saved.sha256,
        displayName: capability.label,
        previewSource: 'managed-asset',
      },
      annotation,
    },
    ...(completed.traceId ? { trace: { traceId: completed.traceId } } : {}),
  };
}

async function jobToken(jobId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jobId)));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
