/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ReportReason } from './ReportReason';
export type ReportResponseDto = {
    /**
     * Created At
     */
    createdAt: string;
    /**
     * Report ID
     */
    id: string;
    /**
     * Additional note
     */
    note?: string | null;
    /**
     * Reason for the report
     */
    reason: ReportReason;
    /**
     * Reporter User ID
     */
    reporterId: string;
    /**
     * Report status
     */
    status: string;
    /**
     * Target Post ID
     */
    targetPostId?: string | null;
    /**
     * Target Entity ID
     */
    targetUserId?: string | null;
};

