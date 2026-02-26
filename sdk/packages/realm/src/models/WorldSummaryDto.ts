/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldSummaryDto = {
    description?: string;
    id: string;
    name: string;
    status: WorldSummaryDto.status;
    updatedAt: string;
};
export namespace WorldSummaryDto {
    export enum status {
        DRAFT = 'DRAFT',
        PENDING_REVIEW = 'PENDING_REVIEW',
        ACTIVE = 'ACTIVE',
        SUSPENDED = 'SUSPENDED',
        ARCHIVED = 'ARCHIVED',
    }
}

