/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CreatorCapabilitiesResponseDto } from '../models/CreatorCapabilitiesResponseDto';
import type { InjectEventResponseDto } from '../models/InjectEventResponseDto';
import type { PermissionCheckResponseDto } from '../models/PermissionCheckResponseDto';
import type { RuleValidationResponseDto } from '../models/RuleValidationResponseDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WorldRulesService {
    /**
     * Get current world rules
     * @param worldId World ID
     * @returns any World rules as JSON object
     * @throws ApiError
     */
    public static worldRulesControllerGetRules(
        worldId: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{worldId}/rules',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Update world rules (Creator only)
     * @param worldId World ID
     * @returns any Updated rules
     * @throws ApiError
     */
    public static worldRulesControllerUpdateRules(
        worldId: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PUT',
            url: '/api/world/by-id/{worldId}/rules',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Get creator capabilities for this world
     * @param worldId World ID
     * @returns CreatorCapabilitiesResponseDto
     * @throws ApiError
     */
    public static worldRulesControllerGetCreatorCapabilities(
        worldId: any,
    ): CancelablePromise<CreatorCapabilitiesResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{worldId}/rules/capabilities',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Check if a specific action is allowed
     * @param action Action to check
     * @param worldId World ID
     * @returns PermissionCheckResponseDto
     * @throws ApiError
     */
    public static worldRulesControllerCheckPermission(
        action: 'INJECT_EVENT' | 'DEFINE_RULES' | 'UPDATE_SETTINGS' | 'PUBLISH_WORLD' | 'ARCHIVE_WORLD' | 'CONTROL_AGENT' | 'CONTROL_USER' | 'FORCE_AGENT_BEHAVIOR' | 'MODIFY_AGENT_IDENTITY',
        worldId: any,
    ): CancelablePromise<PermissionCheckResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{worldId}/rules/check/{action}',
            path: {
                'action': action,
                'worldId': worldId,
            },
        });
    }
    /**
     * List creator-injected world events
     * @param worldId World ID
     * @returns any List of creator world events
     * @throws ApiError
     */
    public static worldRulesControllerListEvents(
        worldId: any,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/world/by-id/{worldId}/rules/events',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Inject a world event (Creator only)
     * @param worldId World ID
     * @returns InjectEventResponseDto
     * @throws ApiError
     */
    public static worldRulesControllerInjectEvent(
        worldId: any,
    ): CancelablePromise<InjectEventResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{worldId}/rules/events',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Validate world rules without saving (public)
     * @param worldId World ID
     * @returns RuleValidationResponseDto
     * @throws ApiError
     */
    public static worldRulesControllerValidateRules(
        worldId: any,
    ): CancelablePromise<RuleValidationResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{worldId}/rules/validate',
            path: {
                'worldId': worldId,
            },
        });
    }
    /**
     * Validate context against agent identity
     * @param worldId World ID
     * @returns RuleValidationResponseDto
     * @throws ApiError
     */
    public static worldRulesControllerValidateContext(
        worldId: any,
    ): CancelablePromise<RuleValidationResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/world/by-id/{worldId}/rules/validate-context',
            path: {
                'worldId': worldId,
            },
        });
    }
}
