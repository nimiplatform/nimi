/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type SatelliteMetadataDto = {
    emotionTags?: Array<string>;
    importance?: number;
    source?: SatelliteMetadataDto.source;
    visibility?: SatelliteMetadataDto.visibility;
};
export namespace SatelliteMetadataDto {
    export enum source {
        USER_INPUT = 'USER_INPUT',
        AGENT_THOUGHT = 'AGENT_THOUGHT',
        SYSTEM_GENERATED = 'SYSTEM_GENERATED',
        GAP_FILL = 'GAP_FILL',
    }
    export enum visibility {
        PUBLIC = 'PUBLIC',
        AGENT_ONLY = 'AGENT_ONLY',
        CREATOR_ONLY = 'CREATOR_ONLY',
    }
}

