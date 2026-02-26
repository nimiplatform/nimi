/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SatelliteDetailDto = {
    content: string;
    createdAt: string;
    expiresAt?: string;
    gapId?: string;
    gravityPhase?: SatelliteDetailDto.gravityPhase;
    id: string;
    metadata?: Record<string, any>;
    narrativeWeight: number;
    provenance: SatelliteDetailDto.provenance;
    referencedCount: number;
    sceneId?: string;
    spineEventId?: string;
    spineId?: string;
    ttl?: number;
    type: SatelliteDetailDto.type;
    verificationStatus?: string;
    worldId: string;
};
export namespace SatelliteDetailDto {
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

