/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PublishWorldDraftResultDto } from '../models/PublishWorldDraftResultDto';
import type { WorldAccessSummaryDto } from '../models/WorldAccessSummaryDto';
import type { WorldDraftDetailDto } from '../models/WorldDraftDetailDto';
import type { WorldDraftSummaryListDto } from '../models/WorldDraftSummaryListDto';
import type { WorldEventListDto } from '../models/WorldEventListDto';
import type { WorldLandingDecisionDto } from '../models/WorldLandingDecisionDto';
import type { WorldLorebookListDto } from '../models/WorldLorebookListDto';
import type { WorldMaintenanceDto } from '../models/WorldMaintenanceDto';
import type { WorldMutationListDto } from '../models/WorldMutationListDto';
import type { WorldSummaryListDto } from '../models/WorldSummaryListDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WorldControlService {
    /**
     * Get my world access capability records
     * @returns WorldAccessSummaryDto
     * @throws ApiError
     */
    public static worldControlControllerGetMyAccess(): CancelablePromise<WorldAccessSummaryDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world-control/access/me',
        });
    }
    /**
     * Resolve world landing decision (NO_ACCESS/CREATE/MAINTAIN)
     * @returns WorldLandingDecisionDto
     * @throws ApiError
     */
    public static worldControlControllerResolveLanding(): CancelablePromise<WorldLandingDecisionDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world-control/landing',
        });
    }
    /**
     * List my world drafts
     * @returns WorldDraftSummaryListDto
     * @throws ApiError
     */
    public static worldControlControllerListDrafts(): CancelablePromise<WorldDraftSummaryListDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world-drafts',
        });
    }
    /**
     * Create world draft
     * @returns WorldDraftDetailDto
     * @throws ApiError
     */
    public static worldControlControllerCreateDraft(): CancelablePromise<WorldDraftDetailDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world-drafts',
        });
    }
    /**
     * Get world draft by id
     * @param draftId World draft ID
     * @returns WorldDraftDetailDto
     * @throws ApiError
     */
    public static worldControlControllerGetDraft(
        draftId: any,
    ): CancelablePromise<WorldDraftDetailDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world-drafts/{draftId}',
            path: {
                'draftId': draftId,
            },
        });
    }
    /**
     * Update world draft
     * @param draftId World draft ID
     * @returns WorldDraftDetailDto
     * @throws ApiError
     */
    public static worldControlControllerUpdateDraft(
        draftId: any,
    ): CancelablePromise<WorldDraftDetailDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/world-drafts/{draftId}',
            path: {
                'draftId': draftId,
            },
        });
    }
    /**
     * Publish world draft
     * @param draftId World draft ID
     * @returns PublishWorldDraftResultDto
     * @throws ApiError
     */
    public static worldControlControllerPublishDraft(
        draftId: any,
    ): CancelablePromise<PublishWorldDraftResultDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world-drafts/{draftId}/publish',
            path: {
                'draftId': draftId,
            },
        });
    }
    /**
     * List worlds I can maintain
     * @returns WorldSummaryListDto
     * @throws ApiError
     */
    public static worldControlControllerListMyWorlds(): CancelablePromise<WorldSummaryListDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/worlds/mine',
        });
    }
    /**
     * List world events
     * @param worldId World ID
     * @returns WorldEventListDto
     * @throws ApiError
     */
    public static worldControlControllerListWorldEvents(
        worldId: any,
    ): CancelablePromise<WorldEventListDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/worlds/{worldId}/events',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Batch upsert world events
     * @param worldId World ID
     * @returns WorldEventListDto
     * @throws ApiError
     */
    public static worldControlControllerBatchUpsertWorldEvents(
        worldId: any,
    ): CancelablePromise<WorldEventListDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/worlds/{worldId}/events/batch-upsert',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Delete world event (logical archive)
     * Marks event as archived; does not physically hard-delete history.
     * @param eventId World event ID
     * @param worldId World ID
     * @returns WorldEventListDto
     * @throws ApiError
     */
    public static worldControlControllerDeleteWorldEvent(
        eventId: any,
        worldId: any,
    ): CancelablePromise<WorldEventListDto> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/worlds/{worldId}/events/{eventId}',
            path: {
                'eventId': eventId,
                'worldId': worldId,
            },
        });
    }
    /**
     * List world lorebooks
     * @param worldId World ID
     * @returns WorldLorebookListDto
     * @throws ApiError
     */
    public static worldControlControllerListWorldLorebooks(
        worldId: any,
    ): CancelablePromise<WorldLorebookListDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/worlds/{worldId}/lorebooks',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Batch upsert world lorebooks
     * @param worldId World ID
     * @returns WorldLorebookListDto
     * @throws ApiError
     */
    public static worldControlControllerBatchUpsertWorldLorebooks(
        worldId: any,
    ): CancelablePromise<WorldLorebookListDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/worlds/{worldId}/lorebooks/batch-upsert',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Delete world lorebook (logical archive)
     * Marks lorebook as archived; does not physically hard-delete history.
     * @param lorebookId World lorebook ID
     * @param worldId World ID
     * @returns WorldLorebookListDto
     * @throws ApiError
     */
    public static worldControlControllerDeleteWorldLorebook(
        lorebookId: any,
        worldId: any,
    ): CancelablePromise<WorldLorebookListDto> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/worlds/{worldId}/lorebooks/{lorebookId}',
            path: {
                'lorebookId': lorebookId,
                'worldId': worldId,
            },
        });
    }
    /**
     * Get world maintenance payload
     * @param worldId World ID
     * @returns WorldMaintenanceDto
     * @throws ApiError
     */
    public static worldControlControllerGetMaintenance(
        worldId: any,
    ): CancelablePromise<WorldMaintenanceDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/worlds/{worldId}/maintenance',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Update world maintenance payload
     * @param worldId World ID
     * @returns WorldMaintenanceDto
     * @throws ApiError
     */
    public static worldControlControllerUpdateMaintenance(
        worldId: any,
    ): CancelablePromise<WorldMaintenanceDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/worlds/{worldId}/maintenance',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * List world mutations for maintenance timeline
     * @param worldId World ID
     * @returns WorldMutationListDto
     * @throws ApiError
     */
    public static worldControlControllerListWorldMutations(
        worldId: any,
    ): CancelablePromise<WorldMutationListDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/worlds/{worldId}/mutations',
            path: {
                'worldId': worldId,
            },
        });
    }
}
