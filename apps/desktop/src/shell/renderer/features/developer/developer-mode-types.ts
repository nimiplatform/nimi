export type DeveloperModeProjection = {
  readonly state: 'disabled' | 'enabled' | 'unavailable';
  readonly enabled: boolean;
  readonly revision: number;
  readonly accountGeneration: number;
  readonly reasonCode: string;
  readonly retryable: boolean;
};
