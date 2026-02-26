/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SpaceTopologyDto = {
    boundary: SpaceTopologyDto.boundary;
    dimensions?: number;
    type: SpaceTopologyDto.type;
};
export namespace SpaceTopologyDto {
    export enum boundary {
        FINITE = 'FINITE',
        INFINITE = 'INFINITE',
        CYCLIC = 'CYCLIC',
    }
    export enum type {
        GRAPH = 'GRAPH',
        GRID = 'GRID',
        FREE = 'FREE',
    }
}

