/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CausalityModelDto } from './CausalityModelDto';
import type { PowerSystemDto } from './PowerSystemDto';
import type { SpaceTopologyDto } from './SpaceTopologyDto';
import type { TimeModelDto } from './TimeModelDto';
export type WorldviewDetailDto = {
    causality: CausalityModelDto;
    coreSystem: PowerSystemDto;
    createdAt: string;
    existences?: Record<string, any>;
    id: string;
    lifecycle: WorldviewDetailDto.lifecycle;
    narrativeHooks?: Record<string, any>;
    resources?: Record<string, any>;
    spaceTopology: SpaceTopologyDto;
    structures?: Record<string, any>;
    timeModel: TimeModelDto;
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

