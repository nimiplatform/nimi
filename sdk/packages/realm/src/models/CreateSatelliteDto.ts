/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SatelliteMetadataDto } from './SatelliteMetadataDto';
export type CreateSatelliteDto = {
    content: string;
    gravityPhase?: CreateSatelliteDto.gravityPhase;
    metadata?: SatelliteMetadataDto;
    narrativeWeight?: number;
    provenance?: CreateSatelliteDto.provenance;
    sceneId?: string;
    spineEventId?: string;
    spineId?: string;
    /**
     * TTL in seconds
     */
    ttl?: number;
    type: CreateSatelliteDto.type;
    worldId: string;
};
export namespace CreateSatelliteDto {
    export enum gravityPhase {
        GESTATION = 'GESTATION',
        CORE = 'CORE',
        SEDIMENTATION = 'SEDIMENTATION',
    }
    export enum provenance {
        REAL = 'REAL',
        SYNTHETIC = 'SYNTHETIC',
    }
    export enum type {
        INNER_VOICE = 'INNER_VOICE',
        CONTEXT = 'CONTEXT',
        WORLD_BUILDING = 'WORLD_BUILDING',
        RELATIONSHIP_MOMENT = 'RELATIONSHIP_MOMENT',
        SCENE_STATE = 'SCENE_STATE',
        EMOTION = 'EMOTION',
        DETAIL = 'DETAIL',
        ATMOSPHERE = 'ATMOSPHERE',
    }
}

