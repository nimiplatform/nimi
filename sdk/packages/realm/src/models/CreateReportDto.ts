/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReportReason } from './ReportReason';
export type CreateReportDto = {
    /**
     * Additional context or description
     */
    description?: string;
    /**
     * Reason for the report
     */
    reason: ReportReason;
    /**
     * ID of the target entity (User, Post, etc.)
     */
    targetId: string;
    /**
     * Type of the target entity
     */
    targetType: CreateReportDto.targetType;
};
export namespace CreateReportDto {
    /**
     * Type of the target entity
     */
    export enum targetType {
        USER = 'USER',
        POST = 'POST',
        AGENT = 'AGENT',
        COMMENT = 'COMMENT',
    }
}

