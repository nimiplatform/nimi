/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CausalityModelDto = {
    allowParadox?: boolean;
    maxChainDepth?: number;
    type: CausalityModelDto.type;
};
export namespace CausalityModelDto {
    export enum type {
        DETERMINISTIC = 'DETERMINISTIC',
        PROBABILISTIC = 'PROBABILISTIC',
        NARRATIVE = 'NARRATIVE',
    }
}

