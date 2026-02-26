/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TimeModelDto = {
    allowReverse?: boolean;
    flowRatio?: number;
    type: TimeModelDto.type;
    unit?: string;
};
export namespace TimeModelDto {
    export enum type {
        TICK_BASED = 'TICK_BASED',
        CONTINUOUS = 'CONTINUOUS',
        RELATIVE = 'RELATIVE',
    }
}

