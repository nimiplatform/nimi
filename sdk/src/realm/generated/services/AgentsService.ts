/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ActivateAgentDto } from '../models/ActivateAgentDto';
import type { AgentVisibilitySettingsDto } from '../models/AgentVisibilitySettingsDto';
import type { ApproveRequestDto } from '../models/ApproveRequestDto';
import type { CreateAgentDto } from '../models/CreateAgentDto';
import type { CreateAgentResponseDto } from '../models/CreateAgentResponseDto';
import type { CreateKeyEventDto } from '../models/CreateKeyEventDto';
import type { ForceActionDto } from '../models/ForceActionDto';
import type { MemoryStatsResponseDto } from '../models/MemoryStatsResponseDto';
import type { RejectRequestDto } from '../models/RejectRequestDto';
import type { RemoveAgentRelationshipDto } from '../models/RemoveAgentRelationshipDto';
import type { SelectAvatarDto } from '../models/SelectAvatarDto';
import type { SetAgentRelationshipDto } from '../models/SetAgentRelationshipDto';
import type { SoulPrimeDto } from '../models/SoulPrimeDto';
import type { UpdateAgentDnaDto } from '../models/UpdateAgentDnaDto';
import type { UpdateAgentVisibilityDto } from '../models/UpdateAgentVisibilityDto';
import type { UpdateSoulPrimeDto } from '../models/UpdateSoulPrimeDto';
import type { UpdateUserProfileDto } from '../models/UpdateUserProfileDto';
import type { UserProfileDto } from '../models/UserProfileDto';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AgentsService {
    /**
     * Incubate a new Agent
     * @param requestBody
     * @returns CreateAgentResponseDto Agent incubation started
     * @throws ApiError
     */
    public static agentControllerCreate(
        requestBody: CreateAgentDto,
    ): CancelablePromise<CreateAgentResponseDto> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent',
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete Agent (private only)
     * @param id Agent ID
     * @returns any
     * @throws ApiError
     */
    public static agentControllerDelete(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get agent by id
     * @param id
     * @returns UserProfileDto
     * @throws ApiError
     */
    public static getAgent(
        id: string,
    ): CancelablePromise<UserProfileDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Activate Agent (Wake up)
     * @param id Agent ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static agentControllerActivate(
        id: string,
        requestBody: ActivateAgentDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/activate',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get Agent Approvals
     * @param id Agent ID
     * @returns any
     * @throws ApiError
     */
    public static agentControllerGetApprovals(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/approvals',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Approve an approval item
     * @param approvalId Approval ID
     * @param id Agent ID
     * @param requestBody
     * @returns any Approval approved (immediate or scheduled)
     * @throws ApiError
     */
    public static agentControllerApprove(
        approvalId: string,
        id: string,
        requestBody: ApproveRequestDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/approvals/{approvalId}/approve',
            path: {
                'approvalId': approvalId,
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Cancel a pending or scheduled approval
     * @param approvalId Approval ID
     * @param id Agent ID
     * @returns any Approval cancelled
     * @throws ApiError
     */
    public static agentControllerCancel(
        approvalId: string,
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/approvals/{approvalId}/cancel',
            path: {
                'approvalId': approvalId,
                'id': id,
            },
        });
    }
    /**
     * Reject an approval item
     * @param approvalId Approval ID
     * @param id Agent ID
     * @param requestBody
     * @returns any Approval rejected
     * @throws ApiError
     */
    public static agentControllerReject(
        approvalId: string,
        id: string,
        requestBody: RejectRequestDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/approvals/{approvalId}/reject',
            path: {
                'approvalId': approvalId,
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Retry a failed approval (re-publish)
     * @param approvalId Approval ID
     * @param id Agent ID
     * @returns any Approval status reset for retry
     * @throws ApiError
     */
    public static agentControllerRetry(
        approvalId: string,
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/approvals/{approvalId}/retry',
            path: {
                'approvalId': approvalId,
                'id': id,
            },
        });
    }
    /**
     * Select avatar for Agent
     * @param id Agent ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static agentControllerSelectAvatar(
        id: string,
        requestBody: SelectAvatarDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/avatar',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Update Agent DNA
     * @param id Agent ID
     * @param requestBody
     * @returns any
     * @throws ApiError
     */
    public static agentControllerUpdateDna(
        id: string,
        requestBody: UpdateAgentDnaDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/agent/accounts/{id}/dna',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Trigger Agent to think and generate content
     * @param id Agent ID
     * @param requestBody
     * @returns any Force action triggered successfully
     * @throws ApiError
     */
    public static agentControllerForceAction(
        id: string,
        requestBody: ForceActionDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/force-action',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * List Core memories (Agent's own experiences, no Entity info)
     * @param id Agent ID
     * @returns any List of Core memories
     * @throws ApiError
     */
    public static agentControllerListCoreMemories(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/core',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Delete all E2E memories for an Entity
     * Entity can request deletion of all their interaction memories with this Agent. Does NOT affect Core memories or E2E memories with other entities.
     * @param entityId Entity ID requesting deletion
     * @param id Agent ID
     * @returns any All E2E memories for this Entity deleted
     * @throws ApiError
     */
    public static agentControllerDeleteAllE2EMemories(
        entityId: string,
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/memory/e2e/{entityId}',
            path: {
                'entityId': entityId,
                'id': id,
            },
        });
    }
    /**
     * List E2E memories for a specific Entity (isolated)
     * @param entityId Entity ID (e.g., User ID)
     * @param id Agent ID
     * @returns any List of E2E memories for this Entity
     * @throws ApiError
     */
    public static agentControllerListE2EMemories(
        entityId: string,
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/e2e/{entityId}',
            path: {
                'entityId': entityId,
                'id': id,
            },
        });
    }
    /**
     * Delete a specific E2E memory
     * Entity can delete their own E2E memories with this Agent. Cannot delete Core memories.
     * @param memoryId Memory ID to delete
     * @param entityId Entity ID (must match memory's subjectId)
     * @param id Agent ID
     * @returns any E2E memory deleted
     * @throws ApiError
     */
    public static agentControllerDeleteE2EMemory(
        memoryId: string,
        entityId: string,
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/memory/e2e/{entityId}/{memoryId}',
            path: {
                'memoryId': memoryId,
                'entityId': entityId,
                'id': id,
            },
        });
    }
    /**
     * List key events for the agent
     * @param id Agent ID
     * @returns any List of key events
     * @throws ApiError
     */
    public static agentControllerListKeyEvents(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/events',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create a key event (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns any Key event created
     * @throws ApiError
     */
    public static agentControllerCreateKeyEvent(
        id: string,
        requestBody: CreateKeyEventDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/memory/events',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Delete a key event (creator only)
     * @param eventId Event ID
     * @param id Agent ID
     * @returns any Key event deleted
     * @throws ApiError
     */
    public static agentControllerDeleteKeyEvent(
        eventId: string,
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/memory/events/{eventId}',
            path: {
                'eventId': eventId,
                'id': id,
            },
        });
    }
    /**
     * List user profiles for the agent
     * @param id Agent ID
     * @returns any List of user profiles
     * @throws ApiError
     */
    public static agentControllerListUserProfiles(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/profiles',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get a specific user profile
     * @param userId User ID
     * @param id Agent ID
     * @returns any User profile data
     * @throws ApiError
     */
    public static agentControllerGetUserProfile(
        userId: string,
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/profiles/{userId}',
            path: {
                'userId': userId,
                'id': id,
            },
        });
    }
    /**
     * Update a user profile (creator only)
     * @param userId User ID
     * @param id Agent ID
     * @param requestBody
     * @returns any User profile updated
     * @throws ApiError
     */
    public static agentControllerUpdateUserProfile(
        userId: string,
        id: string,
        requestBody: UpdateUserProfileDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/agent/accounts/{id}/memory/profiles/{userId}',
            path: {
                'userId': userId,
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Recall memories for Entity interaction (Core + E2E[entityId])
     * Returns Core memories + E2E memories for this specific Entity only. Enforces "no gossip" principle - E2E[A] content is never returned when recalling for Entity B.
     * @param entityId Entity ID interacting with Agent
     * @param id Agent ID
     * @returns any Recalled memories (Core + relevant E2E)
     * @throws ApiError
     */
    public static agentControllerRecallForEntity(
        entityId: string,
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/recall/{entityId}',
            path: {
                'entityId': entityId,
                'id': id,
            },
        });
    }
    /**
     * Get memory statistics for Agent
     * @param id Agent ID
     * @returns MemoryStatsResponseDto Memory statistics
     * @throws ApiError
     */
    public static agentControllerGetMemoryStats(
        id: string,
    ): CancelablePromise<MemoryStatsResponseDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/memory/stats',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Make Agent public (irreversible)
     * @param id Agent ID
     * @returns any
     * @throws ApiError
     */
    public static agentControllerMakePublic(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/public',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Remove a relationship (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns any Relationship removed
     * @throws ApiError
     */
    public static agentControllerRemoveRelationship(
        id: string,
        requestBody: RemoveAgentRelationshipDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'DELETE',
            url: '/api/agent/accounts/{id}/relationships',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get all relationships for the agent
     * @param id Agent ID
     * @returns any List of relationships
     * @throws ApiError
     */
    public static agentControllerGetRelationships(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/relationships',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Create or update a relationship (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns any Relationship created or updated
     * @throws ApiError
     */
    public static agentControllerSetRelationship(
        id: string,
        requestBody: SetAgentRelationshipDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/relationships',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get Agent Soul Prime (creator only)
     * @param id Agent ID
     * @returns SoulPrimeDto Soul Prime configuration
     * @throws ApiError
     */
    public static agentControllerGetSoulPrime(
        id: string,
    ): CancelablePromise<SoulPrimeDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/soul-prime',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update Agent Soul Prime (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns any Soul Prime updated successfully
     * @throws ApiError
     */
    public static agentControllerUpdateSoulPrime(
        id: string,
        requestBody: UpdateSoulPrimeDto,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/agent/accounts/{id}/soul-prime',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Suspend Agent (Sleep)
     * @param id Agent ID
     * @returns any
     * @throws ApiError
     */
    public static agentControllerSuspend(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/api/agent/accounts/{id}/suspend',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get Agent Tasks
     * @param id Agent ID
     * @returns any
     * @throws ApiError
     */
    public static agentControllerGetTasks(
        id: string,
    ): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/tasks',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Get Agent visibility settings (creator only)
     * @param id Agent ID
     * @returns AgentVisibilitySettingsDto Agent visibility settings
     * @throws ApiError
     */
    public static agentControllerGetVisibility(
        id: string,
    ): CancelablePromise<AgentVisibilitySettingsDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/accounts/{id}/visibility',
            path: {
                'id': id,
            },
        });
    }
    /**
     * Update Agent visibility settings (creator only)
     * @param id Agent ID
     * @param requestBody
     * @returns AgentVisibilitySettingsDto Updated agent visibility settings
     * @throws ApiError
     */
    public static agentControllerUpdateVisibility(
        id: string,
        requestBody: UpdateAgentVisibilityDto,
    ): CancelablePromise<AgentVisibilitySettingsDto> {
        return __request(OpenAPI, {
            method: 'PATCH',
            url: '/api/agent/accounts/{id}/visibility',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
        });
    }
    /**
     * Get agent by handle
     * @param handle
     * @returns UserProfileDto
     * @throws ApiError
     */
    public static getAgentByHandle(
        handle: string,
    ): CancelablePromise<UserProfileDto> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/handle/{handle}',
            path: {
                'handle': handle,
            },
        });
    }
    /**
     * Check agent handle availability
     * @returns any
     * @throws ApiError
     */
    public static agentControllerCheckHandle(): CancelablePromise<any> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/api/agent/handles/check',
        });
    }
}
