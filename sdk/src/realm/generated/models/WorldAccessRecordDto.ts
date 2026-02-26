/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorldAccessRecordDto = {
    canCreateWorld: boolean;
    canMaintainWorld: boolean;
    expiresAt?: string;
    id: string;
    maintainRole: WorldAccessRecordDto.maintainRole;
    scopeType: WorldAccessRecordDto.scopeType;
    scopeWorldId?: string;
    status: WorldAccessRecordDto.status;
    userId: string;
};
export namespace WorldAccessRecordDto {
    export enum maintainRole {
        OWNER = 'OWNER',
        MAINTAINER = 'MAINTAINER',
    }
    export enum scopeType {
        GLOBAL = 'GLOBAL',
        WORLD = 'WORLD',
    }
    export enum status {
        ACTIVE = 'ACTIVE',
        REVOKED = 'REVOKED',
        EXPIRED = 'EXPIRED',
        SUSPENDED = 'SUSPENDED',
    }
}

