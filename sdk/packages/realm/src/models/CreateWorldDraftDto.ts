/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateWorldDraftDto = {
    draftPayload?: Record<string, any>;
    pipelineState?: Record<string, any>;
    sourceRef?: string;
    sourceType: CreateWorldDraftDto.sourceType;
    targetWorldId?: string;
};
export namespace CreateWorldDraftDto {
    export enum sourceType {
        TEXT = 'TEXT',
        FILE = 'FILE',
    }
}

