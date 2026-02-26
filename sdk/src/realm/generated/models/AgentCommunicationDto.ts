/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AgentCommunicationDto = {
    formality: AgentCommunicationDto.formality;
    responseLength: AgentCommunicationDto.responseLength;
    sentiment: AgentCommunicationDto.sentiment;
    summary?: string;
};
export namespace AgentCommunicationDto {
    export enum formality {
        CASUAL = 'casual',
        FORMAL = 'formal',
        SLANG = 'slang',
    }
    export enum responseLength {
        SHORT = 'short',
        MEDIUM = 'medium',
        LONG = 'long',
    }
    export enum sentiment {
        POSITIVE = 'positive',
        NEUTRAL = 'neutral',
        CYNICAL = 'cynical',
    }
}

