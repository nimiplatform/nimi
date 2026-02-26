/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentRelationType } from './AgentRelationType';
export type RelationshipResponseDto = {
    context?: string | null;
    createdAt: string;
    id: string;
    sourceId: string;
    strength: number;
    targetId: string;
    type: AgentRelationType;
};

