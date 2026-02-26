/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TimeGapDetailDto = {
    agentId: string;
    collapseStatus: TimeGapDetailDto.collapseStatus;
    createdAt: string;
    id: string;
    lastActiveAt: string;
    /**
     * Real gap duration in milliseconds
     */
    realGapDuration: number;
    returnedAt: string;
    spineId: string;
    syntheticMemoryIds: Array<string>;
    userId: string;
    /**
     * World gap duration in milliseconds
     */
    worldGapDuration: number;
    worldId: string;
};
export namespace TimeGapDetailDto {
    export enum collapseStatus {
        PENDING = 'PENDING',
        GENERATING = 'GENERATING',
        COLLAPSED = 'COLLAPSED',
        SKIPPED = 'SKIPPED',
    }
}

