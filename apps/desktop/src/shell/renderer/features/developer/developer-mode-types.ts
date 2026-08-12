export type DeveloperModeProjection = {
  readonly state: 'disabled' | 'enabled' | 'unavailable';
  readonly enabled: boolean;
  readonly revision: number;
  readonly reasonCode: string;
  readonly retryable: boolean;
};
