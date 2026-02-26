/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type NarrativeSpineEventDetailDto = {
    branchId: string;
    canonFlag: boolean;
    causalLinks: Array<string>;
    createdAt: string;
    directorsCut?: Record<string, any>;
    gravityField?: Record<string, any>;
    id: string;
    narrativeWeight: number;
    parentEventId?: string;
    payload: Record<string, any>;
    sceneId?: string;
    sequence: number;
    spineId: string;
    timestamp: string;
    type: NarrativeSpineEventDetailDto.type;
};
export namespace NarrativeSpineEventDetailDto {
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

