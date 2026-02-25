/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreatorModControlManifestVerifyRequestDto = {
    manifest: Record<string, any>;
    modId: string;
    mode: CreatorModControlManifestVerifyRequestDto.mode;
    version: string;
};
export namespace CreatorModControlManifestVerifyRequestDto {
    export enum mode {
        LOCAL_DEV = 'local-dev',
        COMMUNITY = 'community',
        OFFICIAL = 'official',
        SIDELOAD = 'sideload',
    }
}

