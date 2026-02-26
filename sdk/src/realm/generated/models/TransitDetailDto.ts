/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TransitSessionDataDto } from './TransitSessionDataDto';
export type TransitDetailDto = {
    agentId: string;
    arrivedAt?: string | null;
    createdAt: string;
    departedAt: string;
    fromWorldId?: string | null;
    id: string;
    sessionData?: TransitSessionDataDto | null;
    status: TransitDetailDto.status;
    toWorldId: string;
    transitType: TransitDetailDto.transitType;
    userId: string;
};
export namespace TransitDetailDto {
    export enum status {
        ACTIVE = 'ACTIVE',
        COMPLETED = 'COMPLETED',
        ABANDONED = 'ABANDONED',
    }
    export enum transitType {
        INBOUND = 'INBOUND',
        OUTBOUND = 'OUTBOUND',
    }
}

