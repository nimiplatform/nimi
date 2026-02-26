/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldDetailDto = {
    agentCount: number;
    bannerUrl?: string;
    createdAt: string;
    creatorId?: string;
    description?: string;
    freezeReason?: WorldDetailDto.freezeReason;
    iconUrl?: string;
    id: string;
    level: number;
    levelUpdatedAt?: string;
    lorebookEntryLimit: number;
    name: string;
    nativeAgentLimit: number;
    nativeCreationState: WorldDetailDto.nativeCreationState;
    rules?: Record<string, any>;
    scoreA: number;
    scoreC: number;
    scoreE: number;
    scoreEwma: number;
    scoreQ: number;
    status: WorldDetailDto.status;
    timeFlowRatio: number;
    transitInLimit: number;
    type: WorldDetailDto.type;
};
export namespace WorldDetailDto {
    export enum freezeReason {
        QUOTA_OVERFLOW = 'QUOTA_OVERFLOW',
        WORLD_INACTIVE = 'WORLD_INACTIVE',
        GOVERNANCE_LOCK = 'GOVERNANCE_LOCK',
    }
    export enum nativeCreationState {
        OPEN = 'OPEN',
        NATIVE_CREATION_FROZEN = 'NATIVE_CREATION_FROZEN',
    }
    export enum status {
        DRAFT = 'DRAFT',
        PENDING_REVIEW = 'PENDING_REVIEW',
        ACTIVE = 'ACTIVE',
        SUSPENDED = 'SUSPENDED',
        ARCHIVED = 'ARCHIVED',
    }
    export enum type {
        MAIN = 'MAIN',
        SUB = 'SUB',
    }
}
