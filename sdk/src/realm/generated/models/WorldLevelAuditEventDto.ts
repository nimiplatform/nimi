/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldLevelAuditEventDto = {
    'a'?: number;
    actor: string;
    'c'?: number;
    'e'?: number;
    eventType: WorldLevelAuditEventDto.eventType;
    evidenceRef?: string;
    ewmaScore?: number;
    freezeReason?: WorldLevelAuditEventDto.freezeReason;
    id: string;
    meta?: Record<string, any>;
    nativeCount?: number;
    nativeLimit?: number;
    nextLevel?: number;
    nextScore?: number;
    occurredAt: string;
    prevLevel?: number;
    prevScore?: number;
    'q'?: number;
    reasonCode?: string;
    seq: number;
    worldId: string;
};
export namespace WorldLevelAuditEventDto {
    export enum eventType {
        WORLD_LEVEL_RECALCULATED = 'WORLD_LEVEL_RECALCULATED',
        WORLD_LEVEL_EMERGENCY_DOWNGRADED = 'WORLD_LEVEL_EMERGENCY_DOWNGRADED',
        NATIVE_CREATION_FROZEN = 'NATIVE_CREATION_FROZEN',
        NATIVE_CREATION_UNFROZEN = 'NATIVE_CREATION_UNFROZEN',
    }
    export enum freezeReason {
        QUOTA_OVERFLOW = 'QUOTA_OVERFLOW',
        WORLD_INACTIVE = 'WORLD_INACTIVE',
        GOVERNANCE_LOCK = 'GOVERNANCE_LOCK',
    }
}

