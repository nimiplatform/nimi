/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentRelationType } from './AgentRelationType';
export type CreateRelationshipDto = {
    /**
     * Context note
     */
    context?: string;
    /**
     * Strength of relationship (0-100)
     */
    strength?: number;
    /**
     * Target Account ID to relate to
     */
    targetId: string;
    type: AgentRelationType;
};

