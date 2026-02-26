/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreateReportDto } from '../models/CreateReportDto';
import type { ReportResponseDto } from '../models/ReportResponseDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class GovernanceService {
    /**
     * Submit a report
     * Report a user, post, agent, or comment for moderation.
     * @param requestBody
     * @returns ReportResponseDto Report submitted successfully
     * @throws ApiError
     */
    public static reportControllerCreateReport(
        requestBody: CreateReportDto,
    ): CancelablePromise<ReportResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/reports',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
