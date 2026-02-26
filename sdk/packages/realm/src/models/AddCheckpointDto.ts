/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AddCheckpointDto = {
    data?: Record<string, any>;
    name: string;
    status: AddCheckpointDto.status;
};
export namespace AddCheckpointDto {
    export enum status {
        PASSED = 'PASSED',
        FAILED = 'FAILED',
        SKIPPED = 'SKIPPED',
    }
}

