/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreatorModControlAuditRecordDto = {
    decision?: CreatorModControlAuditRecordDto.decision;
    eventType: string;
    modId?: string;
    /**
     * ISO datetime
     */
    occurredAt: string;
    payload?: Record<string, any>;
    reasonCodes?: Array<string>;
    stage?: CreatorModControlAuditRecordDto.stage;
};
export namespace CreatorModControlAuditRecordDto {
    export enum decision {
        ALLOW = 'ALLOW',
        ALLOW_WITH_WARNING = 'ALLOW_WITH_WARNING',
        DENY = 'DENY',
    }
    export enum stage {
        DISCOVERY = 'discovery',
        MANIFEST_COMPAT = 'manifest/compat',
        SIGNATURE_AUTH = 'signature/auth',
        DEPENDENCY_BUILD = 'dependency/build',
        SANDBOX_POLICY = 'sandbox/policy',
        LOAD = 'load',
        LIFECYCLE = 'lifecycle',
        AUDIT = 'audit',
    }
}

