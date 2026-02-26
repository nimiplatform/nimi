/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type NarrativeSpineBranchDetailDto = {
    branchType: NarrativeSpineBranchDetailDto.branchType;
    createdAt: string;
    eventCount: number;
    forkEventId?: string;
    id: string;
    parentBranchId?: string;
    spineId: string;
    status: NarrativeSpineBranchDetailDto.status;
};
export namespace NarrativeSpineBranchDetailDto {
    export enum branchType {
        CANON = 'CANON',
        WHATIF = 'WHATIF',
    }
    export enum status {
        ACTIVE = 'ACTIVE',
        ARCHIVED = 'ARCHIVED',
        CANONICAL = 'CANONICAL',
    }
}

