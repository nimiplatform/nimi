/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AdminModerationLogResponseDto } from '../models/AdminModerationLogResponseDto';
import type { AdminPostListResponseDto } from '../models/AdminPostListResponseDto';
import type { AdminUpdatePostStatusDto } from '../models/AdminUpdatePostStatusDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AdminModerationService {
    /**
     * List moderation logs (Audit)
     * @param limit
     * @param page
     * @param targetAccountId
     * @param actionType
     * @param operatorId
     * @returns AdminModerationLogResponseDto
     * @throws ApiError
     */
    public static adminModerationControllerListModerationLogs(
        limit?: number,
        page?: number,
        targetAccountId?: any,
        actionType?: any,
        operatorId?: any,
    ): CancelablePromise<AdminModerationLogResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/moderation-logs',
            query: {
                'limit': limit,
                'page': page,
                'targetAccountId': targetAccountId,
                'actionType': actionType,
                'operatorId': operatorId,
            },
        });
    }
    /**
     * List all posts with filters (Admin only)
     * @param limit
     * @param page
     * @param search
     * @param contentRating
     * @param moderationStatus
     * @param authorId
     * @returns AdminPostListResponseDto
     * @throws ApiError
     */
    public static adminModerationControllerListPosts(
        limit?: number,
        page?: number,
        search?: any,
        contentRating?: any,
        moderationStatus?: any,
        authorId?: any,
    ): CancelablePromise<AdminPostListResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/posts',
            query: {
                'limit': limit,
                'page': page,
                'search': search,
                'contentRating': contentRating,
                'moderationStatus': moderationStatus,
                'authorId': authorId,
            },
        });
    }
    /**
     * Batch Delete Posts
     * @returns any
     * @throws ApiError
     */
    public static adminModerationControllerBatchDelete(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/admin/posts/batch-delete',
        });
    }
    /**
     * Force Delete Post
     * @param id Post ID
     * @returns any
     * @throws ApiError
     */
    public static adminModerationControllerDeletePost(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/admin/posts/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get Post Snapshot (including deleted)
     * @param id Post ID
     * @returns any
     * @throws ApiError
     */
    public static adminModerationControllerGetPostSnapshot(
        id: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/posts/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update Post Moderation Status
     * @param id Post ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static adminModerationControllerUpdatePostStatus(
        id: any,
        requestBody: AdminUpdatePostStatusDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/admin/posts/{id}/status',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List reports (Admin only)
     * @param limit
     * @param page
     * @param reason
     * @param status
     * @returns any List of reports
     * @throws ApiError
     */
    public static adminModerationControllerListReportsForAdmin(
        limit?: number,
        page?: number,
        reason?: any,
        status?: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/admin/reports',
            query: {
                'limit': limit,
                'page': page,
                'reason': reason,
                'status': status,
            },
        });
    }
    /**
     * Resolve a report
     * @param id Report ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static adminModerationControllerResolveReport(
        id: any,
        requestBody: {
            note?: string;
            resolution?: string;
        },
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/admin/reports/{id}/resolve',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
}
