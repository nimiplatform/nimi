/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type VerifySyntheticMemoryDto = {
    reason?: string;
    status: VerifySyntheticMemoryDto.status;
};
export namespace VerifySyntheticMemoryDto {
    export enum status {
        CANONIZED = 'canonized',
        REJECTED = 'rejected',
    }
}

