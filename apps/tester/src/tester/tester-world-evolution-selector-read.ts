import { createMissingWorldEvolutionSelectorReadProvider } from '@nimiplatform/sdk/runtime';

export type TesterWorldEvolutionSelectorReadProjection = {
  optionalReadCount: number;
  missingEvidenceCategory: string;
};

export async function loadTesterWorldEvolutionSelectorReadProjection(): Promise<TesterWorldEvolutionSelectorReadProjection> {
  const provider = createMissingWorldEvolutionSelectorReadProvider({
    backingBoundary: 'tester-world-evolution-selector-read',
  });
  const executionEvents = await provider.executionEvents.read({ worldId: 'tester-world' });
  try {
    await provider.checkpoints.read({ worldId: 'tester-world' });
  } catch (error) {
    const details = (error as { details?: Record<string, unknown> }).details || {};
    return {
      optionalReadCount: executionEvents.length,
      missingEvidenceCategory: String(details.rejectionCategory || 'unknown'),
    };
  }
  return {
    optionalReadCount: executionEvents.length,
    missingEvidenceCategory: 'not_rejected',
  };
}
