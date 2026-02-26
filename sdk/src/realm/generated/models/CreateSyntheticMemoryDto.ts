/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { SatelliteMetadataDto } from './SatelliteMetadataDto';
export type CreateSyntheticMemoryDto = {
    confidence?: number;
    content: string;
    gapId: string;
    metadata?: SatelliteMetadataDto;
    type: CreateSyntheticMemoryDto.type;
};
export namespace CreateSyntheticMemoryDto {
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

