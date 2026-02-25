/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldviewDetailDto = {
    causality: Record<string, any>;
    coreSystem: Record<string, any>;
    createdAt: string;
    existences?: Record<string, any>;
    id: string;
    knowledge?: Record<string, any>;
    lifecycle: WorldviewDetailDto.lifecycle;
    narrativeHooks?: Record<string, any>;
    resources?: Record<string, any>;
    spaceTopology: Record<string, any>;
    structures?: Record<string, any>;
    timeModel: Record<string, any>;
    updatedAt: string;
    version: number;
    visualGuide?: Record<string, any>;
    worldId: string;
};
export namespace WorldviewDetailDto {
    export enum lifecycle {
        ACTIVE = 'ACTIVE',
        MAINTENANCE = 'MAINTENANCE',
        FROZEN = 'FROZEN',
        ARCHIVED = 'ARCHIVED',
    }
}

