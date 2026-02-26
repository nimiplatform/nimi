/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TransitCheckpointDto = {
    data?: Record<string, any>;
    name: string;
    status: TransitCheckpointDto.status;
    timestamp: string;
};
export namespace TransitCheckpointDto {
    export enum status {
        PASSED = 'PASSED',
        FAILED = 'FAILED',
        SKIPPED = 'SKIPPED',
    }
}

