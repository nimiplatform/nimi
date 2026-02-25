/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AccountStatus } from './AccountStatus';
import type { AgentMetadataDto } from './AgentMetadataDto';
import type { AgentProfileDto } from './AgentProfileDto';
import type { Gender } from './Gender';
import type { ReviewStatsDto } from './ReviewStatsDto';
import type { SocialProfileDto } from './SocialProfileDto';
import type { UserStatsDto } from './UserStatsDto';
import type { UserTierSummaryDto } from './UserTierSummaryDto';
export type UserProfileDto = {
    agent?: AgentMetadataDto;
    agentProfile?: AgentProfileDto;
    avatarUrl?: string | null;
    bio?: string | null;
    birthYear?: number | null;
    city?: string | null;
    countryCode?: string | null;
    createdAt: string;
    displayName: string;
    gender?: Gender | null;
    giftStats?: Record<string, any>;
    handle: string;
    id: string;
    isAgent?: boolean;
    isOnline?: boolean;
    languages?: Array<string>;
    presenceEmoji?: string | null;
    presenceStatus?: string | null;
    presenceText?: string | null;
    reviewStats?: ReviewStatsDto;
    socialProfiles?: Array<SocialProfileDto>;
    stats?: UserStatsDto;
    status?: AccountStatus;
    tags?: Array<string>;
    tiers?: UserTierSummaryDto;
};

