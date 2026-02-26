import type {
  HookAuditRecord,
  HookAuditStats,
  HookRegistrationRecord,
  HookSourceType,
  HookType,
} from './shared';

export type RuntimeHookAuditFacade = {
  getAudit: (filter?: {
    modId?: string;
    hookType?: HookType;
    target?: string;
    decision?: 'ALLOW' | 'ALLOW_WITH_WARNING' | 'DENY';
    since?: string;
    limit?: number;
  }) => HookAuditRecord[];
  getAuditStats: (modId?: string) => HookAuditStats;
};

export type RuntimeHookMetaFacade = {
  listRegistrations: (modId?: string) => HookRegistrationRecord[];
  listModCapabilities: (modId: string) => string[];
  getPermissionDeclaration: (modId: string) => {
    sourceType: HookSourceType;
    baseline: string[];
    grants: string[];
    denials: string[];
  };
};

export type HookAuditClient = {
  query: (filter?: {
    modId?: string;
    hookType?: HookType;
    target?: string;
    decision?: 'ALLOW' | 'ALLOW_WITH_WARNING' | 'DENY';
    since?: string;
    limit?: number;
  }) => HookAuditRecord[];
  stats: (modId?: string) => HookAuditStats;
};

export type HookMetaClient = {
  listRegistrations: (modId?: string) => HookRegistrationRecord[];
  listCapabilities: (modId: string) => string[];
  getPermissions: (modId: string) => {
    sourceType: HookSourceType;
    baseline: string[];
    grants: string[];
    denials: string[];
  };
};
