export type ModelPickerDetailRow = {
  label: string;
  value: string;
};

export type ModelPickerBadgeTone = 'neutral' | 'accent' | 'success' | 'warning';

export type ModelPickerBadge = {
  label: string;
  tone?: ModelPickerBadgeTone;
};

export type ModelPickerGroup<TModel> = {
  key: string;
  label: string;
  models: readonly TModel[];
};

export interface ModelCatalogAdapter<TModel> {
  listModels: () => Promise<readonly TModel[]> | readonly TModel[];
  getId: (model: TModel) => string;
  getTitle: (model: TModel) => string;
  getDescription?: (model: TModel) => string | undefined;
  getCapabilities?: (model: TModel) => readonly string[];
  getBadges?: (model: TModel) => readonly ModelPickerBadge[];
  getSource?: (model: TModel) => string | undefined;
  getDetailRows?: (model: TModel) => readonly ModelPickerDetailRow[];
  getGroupKey?: (model: TModel) => string | undefined;
  getGroupLabel?: (groupKey: string, models: readonly TModel[]) => string;
  getSearchText?: (model: TModel) => string | undefined;
}
