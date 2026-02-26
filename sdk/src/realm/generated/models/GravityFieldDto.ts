/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type GravityFieldDto = {
    attractedTypes?: Array<string>;
    decay?: GravityFieldDto.decay;
    radius?: number;
    /**
     * Gravity strength (0-1)
     */
    strength: number;
    type: GravityFieldDto.type;
};
export namespace GravityFieldDto {
    export enum decay {
        LINEAR = 'LINEAR',
        EXPONENTIAL = 'EXPONENTIAL',
        STEP = 'STEP',
    }
    export enum type {
        EMOTIONAL = 'EMOTIONAL',
        NARRATIVE = 'NARRATIVE',
        CAUSAL = 'CAUSAL',
        TEMPORAL = 'TEMPORAL',
    }
}

