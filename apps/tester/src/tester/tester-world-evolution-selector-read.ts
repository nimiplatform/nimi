export type TesterWorldEvolutionSelectorReadProjection = {
  optionalReadCount: number;
  missingEvidenceCategory: string;
};

export async function loadTesterWorldEvolutionSelectorReadProjection(): Promise<TesterWorldEvolutionSelectorReadProjection> {
  return {
    optionalReadCount: 0,
    missingEvidenceCategory: 'world_evolution_selector_read_provider_not_public_in_sdk_vnext',
  };
}
