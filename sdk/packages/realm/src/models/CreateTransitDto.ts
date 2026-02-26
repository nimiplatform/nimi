/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type CreateTransitDto = {
    agentId: string;
    carriedState?: Record<string, any>;
    fromWorldId?: string;
    reason?: string;
    toWorldId: string;
    transitType: CreateTransitDto.transitType;
};
export namespace CreateTransitDto {
    export enum transitType {
        INBOUND = 'INBOUND',
        OUTBOUND = 'OUTBOUND',
    }
}

