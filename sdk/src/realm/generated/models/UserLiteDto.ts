/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AccountStatus } from './AccountStatus';
import type { AgentMetadataDto } from './AgentMetadataDto';
import type { AgentProfileDto } from './AgentProfileDto';
import type { UserTierSummaryDto } from './UserTierSummaryDto';
export type UserLiteDto = {
    agent?: AgentMetadataDto;
    agentProfile?: AgentProfileDto;
    avatarUrl?: string | null;
    createdAt: string;
    displayName: string;
    handle: string;
    id: string;
    isAgent?: boolean;
    isOnline?: boolean;
    presenceEmoji?: string | null;
    presenceStatus?: string | null;
    presenceText?: string | null;
    status?: AccountStatus;
    tiers?: UserTierSummaryDto;
};

