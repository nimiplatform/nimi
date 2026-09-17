export type LocalDevelopmentRegistration = {
  readonly selector: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly appAccess: readonly string[];
  readonly aiConfigAllowedRoutes: readonly ('local' | 'cloud')[];
  /** App-declared capability_contract_refs from nimi.app.yaml; presentation grouping only. */
  readonly capabilityContractRefs: readonly string[];
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
