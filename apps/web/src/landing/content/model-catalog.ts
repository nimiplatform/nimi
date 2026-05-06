export type ModelCatalogProvider = {
  provider: string;
  runtimePlane: 'local' | 'cloud';
  capabilities: string[];
  models: string[];
};

// Provider/model details are intentionally withheld from the landing projection
// until runtime catalog evidence is admitted for public publication.
export const MODEL_CATALOG_PROVIDERS: ModelCatalogProvider[] = [];
