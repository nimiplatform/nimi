/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type UpdateWorldDraftDto = {
    draftPayload?: Record<string, any>;
    pipelineState?: Record<string, any>;
    status?: UpdateWorldDraftDto.status;
};
export namespace UpdateWorldDraftDto {
    export enum status {
        DRAFT = 'DRAFT',
        READY = 'READY',
        ARCHIVED = 'ARCHIVED',
    }
}

