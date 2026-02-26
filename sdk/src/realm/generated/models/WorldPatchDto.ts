/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldPatchDto = {
    bannerUrl?: string;
    description?: string;
    era?: string;
    genre?: string;
    iconUrl?: string;
    name?: string;
    rules?: Record<string, any>;
    status?: WorldPatchDto.status;
    themes?: Array<string>;
    timeFlowRatio?: number;
};
export namespace WorldPatchDto {
    export enum status {
        DRAFT = 'DRAFT',
        PENDING_REVIEW = 'PENDING_REVIEW',
        ACTIVE = 'ACTIVE',
        SUSPENDED = 'SUSPENDED',
        ARCHIVED = 'ARCHIVED',
    }
}

