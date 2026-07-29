export type LocalDevelopmentPermissionRequirement = {
  readonly permissionId: string;
  readonly reason: string;
};

export type LocalDevelopmentApproval = {
  readonly requestId: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly accountId: string;
  readonly permissionRequirements: readonly LocalDevelopmentPermissionRequirement[];
  readonly approvalState: string;
};

export type LocalDevelopmentAuthorization = {
  readonly selector: string;
  readonly appId: string;
  readonly displayName: string;
  readonly canonicalProjectRoot: string;
  readonly shell: 'electron';
  readonly accountId: string;
  readonly permissionRequirements: readonly LocalDevelopmentPermissionRequirement[];
  readonly persistence: string;
  readonly state: string;
  readonly updatedAtUnixMs: number;
};

export type LocalDevelopmentRun = {
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

export type LocalDevelopmentDecision = 'deny' | 'allow-run-once' | 'allow-project';
