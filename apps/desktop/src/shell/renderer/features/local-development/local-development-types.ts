export type LocalDevelopmentRegistration = {
  readonly selector: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly appAccess: readonly string[];
  readonly aiConfigAllowedRoutes: readonly ('local' | 'cloud')[];
  readonly sourceGeneration: number;
  readonly declarationGeneration: number;
  readonly registeredAtUnixMs: number;
  readonly updatedAtUnixMs: number;
};

export type LocalDevelopmentRun = {
  readonly selector: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly state: string;
  readonly message: string;
  readonly reasonCode?: string;
  readonly retryable: boolean;
  readonly hostGeneration: number;
};
