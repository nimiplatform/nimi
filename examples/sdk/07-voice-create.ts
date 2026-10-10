import type { NimiLocalAppClient } from '@nimiplatform/sdk';

/** Save clientSubmissionId in App storage before calling; recover the original Job by it. */
export async function submitVoiceDescription(
  client: NimiLocalAppClient,
  clientSubmissionId: string,
  instructionText: string,
  previewText: string,
) {
  return await client.ai.scenarioJobs.submit({
    type: 'voice-create',
    creationSource: 'text-description',
    instructionText,
    previewText,
    language: 'en',
    preferredName: 'My voice',
  }, { clientSubmissionId });
}
