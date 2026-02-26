/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { DetectedGapDto } from '../models/DetectedGapDto';
import type { TimeGapDetailDto } from '../models/TimeGapDetailDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TimeGapNarrativeService {
    /**
     * List time gaps for a spine
     * @param spineId Spine ID
     * @returns TimeGapDetailDto
     * @throws ApiError
     */
    public static timeGapControllerFindBySpine(
        spineId: any,
    ): CancelablePromise<Array<TimeGapDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/time-gaps/by-spine/{spineId}',
            path: {
                'spineId': spineId,
            },
        });
    }
    /**
     * Detect time gap for a spine
     * @param agentId Agent ID
     * @param spineId Spine ID
     * @returns DetectedGapDto
     * @throws ApiError
     */
    public static timeGapControllerDetectGap(
        agentId: any,
        spineId: any,
    ): CancelablePromise<DetectedGapDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/time-gaps/detect/{spineId}/{agentId}',
            path: {
                'agentId': agentId,
                'spineId': spineId,
            },
        });
    }
    /**
     * List pending time gaps for current user
     * @returns TimeGapDetailDto
     * @throws ApiError
     */
    public static timeGapControllerFindPendingGaps(): CancelablePromise<Array<TimeGapDetailDto>> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/time-gaps/pending/mine',
        });
    }
    /**
     * Get a specific time gap
     * @param gapId Time Gap ID
     * @returns TimeGapDetailDto
     * @throws ApiError
     */
    public static timeGapControllerGetGap(
        gapId: any,
    ): CancelablePromise<TimeGapDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/time-gaps/{gapId}',
            path: {
                'gapId': gapId,
            },
        });
    }
    /**
     * Trigger collapse for a time gap (generate synthetic memories)
     * @param gapId Time Gap ID
     * @returns TimeGapDetailDto
     * @throws ApiError
     */
    public static timeGapControllerCollapseGap(
        gapId: any,
    ): CancelablePromise<TimeGapDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/time-gaps/{gapId}/collapse',
            path: {
                'gapId': gapId,
            },
        });
    }
    /**
     * Skip a time gap (no synthetic memories)
     * @param gapId Time Gap ID
     * @returns TimeGapDetailDto
     * @throws ApiError
     */
    public static timeGapControllerSkipGap(
        gapId: any,
    ): CancelablePromise<TimeGapDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/time-gaps/{gapId}/skip',
            path: {
                'gapId': gapId,
            },
        });
    }
}
