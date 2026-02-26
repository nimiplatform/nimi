/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldDraftSummaryDto = {
    id: string;
    publishedAt?: string;
    sourceRef?: string;
    sourceType: WorldDraftSummaryDto.sourceType;
    status: WorldDraftSummaryDto.status;
    targetWorldId?: string;
    updatedAt: string;
};
export namespace WorldDraftSummaryDto {
    export enum sourceType {
        TEXT = 'TEXT',
        FILE = 'FILE',
    }
    export enum status {
        DRAFT = 'DRAFT',
        READY = 'READY',
        PUBLISHED = 'PUBLISHED',
        ARCHIVED = 'ARCHIVED',
    }
}

