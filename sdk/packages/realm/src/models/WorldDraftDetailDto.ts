/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldDraftDetailDto = {
    createdAt: string;
    draftPayload?: Record<string, any>;
    id: string;
    ownerUserId: string;
    pipelineState?: Record<string, any>;
    publishResult?: Record<string, any>;
    publishedAt?: string;
    sourceRef?: string;
    sourceType: WorldDraftDetailDto.sourceType;
    status: WorldDraftDetailDto.status;
    targetWorldId?: string;
    updatedAt: string;
};
export namespace WorldDraftDetailDto {
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

