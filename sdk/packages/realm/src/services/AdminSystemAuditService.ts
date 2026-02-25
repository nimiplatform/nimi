/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AdminAuditLogListResponseDto } from '../models/AdminAuditLogListResponseDto';
import type { AdminSensitiveWordsDto } from '../models/AdminSensitiveWordsDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminSystemAuditService {
    /**
     * List system audit logs
     * @param operatorId
     * @param targetId
     * @param actionType
     * @param page
     * @param limit
     * @returns AdminAuditLogListResponseDto
     * @throws ApiError
     */
    public static adminSystemControllerListAuditLogs(
        operatorId?: string,
        targetId?: string,
        actionType?: string,
        page?: number,
        limit?: number,
    ): CancelablePromise<AdminAuditLogListResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/system/audit-logs',
            query: {
                'operatorId': operatorId,
                'targetId': targetId,
                'actionType': actionType,
                'page': page,
                'limit': limit,
            },
        });
    }
    /**
     * Get Sensitive Words List
     * @returns any
     * @throws ApiError
     */
    public static adminSystemControllerGetSensitiveWords(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/system/config/sensitive-words',
        });
    }
    /**
     * Update Sensitive Words (Add/Remove/Set)
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static adminSystemControllerUpdateSensitiveWords(
        requestBody: AdminSensitiveWordsDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/admin/system/config/sensitive-words',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get Global System Stats
     * @returns any
     * @throws ApiError
     */
    public static adminSystemControllerGetStats(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/system/stats/overview',
        });
    }
}
