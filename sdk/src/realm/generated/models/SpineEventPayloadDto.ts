/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SpineEventPayloadDto = {
    content: string;
    metadata?: Record<string, any>;
    participants?: Array<string>;
    sceneContext?: Record<string, any>;
    type: SpineEventPayloadDto.type;
};
export namespace SpineEventPayloadDto {
    export enum type {
        DIALOGUE = 'DIALOGUE',
        ACTION = 'ACTION',
        THOUGHT = 'THOUGHT',
        OBSERVATION = 'OBSERVATION',
        EMOTION = 'EMOTION',
        DECISION = 'DECISION',
        MEMORY = 'MEMORY',
        GRAVITY = 'GRAVITY',
        SYSTEM = 'SYSTEM',
        TIMESKIP = 'TIMESKIP',
        BRANCH_POINT = 'BRANCH_POINT',
    }
}

