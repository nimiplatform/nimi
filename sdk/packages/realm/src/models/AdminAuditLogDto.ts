/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AdminAuditLogDto = {
    actionType: string;
    changes?: Record<string, any>;
    createdAt: string;
    details?: Record<string, any>;
    id: string;
    itemId?: string | null;
    itemType?: string | null;
    operatorId: string;
    reason?: string | null;
    reportId?: string | null;
    targetAccountId?: string | null;
    targetPostId?: string | null;
};

