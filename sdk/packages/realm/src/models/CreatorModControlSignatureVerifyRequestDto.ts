/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreatorModControlSignatureVerifyRequestDto = {
    digest: string;
    modId: string;
    mode: CreatorModControlSignatureVerifyRequestDto.mode;
    signature: string;
    signerId: string;
    version: string;
};
export namespace CreatorModControlSignatureVerifyRequestDto {
    export enum mode {
        LOCAL_DEV = 'local-dev',
        COMMUNITY = 'community',
        OFFICIAL = 'official',
        SIDELOAD = 'sideload',
    }
}

