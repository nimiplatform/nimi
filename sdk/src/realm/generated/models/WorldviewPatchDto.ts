/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldviewPatchDto = {
    causality?: Record<string, any>;
    coreSystem?: Record<string, any>;
    existences?: Record<string, any>;
    lifecycle?: WorldviewPatchDto.lifecycle;
    narrativeHooks?: Record<string, any>;
    resources?: Record<string, any>;
    spaceTopology?: Record<string, any>;
    structures?: Record<string, any>;
    timeModel?: Record<string, any>;
    visualGuide?: Record<string, any>;
};
export namespace WorldviewPatchDto {
    export enum lifecycle {
        ACTIVE = 'ACTIVE',
        MAINTENANCE = 'MAINTENANCE',
        FROZEN = 'FROZEN',
        ARCHIVED = 'ARCHIVED',
    }
}

