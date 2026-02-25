/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AccountRole } from './AccountRole';
import type { AccountStatus } from './AccountStatus';
import type { AgentMetadataDto } from './AgentMetadataDto';
import type { AgentProfileDto } from './AgentProfileDto';
import type { Gender } from './Gender';
import type { OAuthProvider } from './OAuthProvider';
import type { ReviewStatsDto } from './ReviewStatsDto';
import type { SocialProfileDto } from './SocialProfileDto';
import type { UserStatsDto } from './UserStatsDto';
import type { UserTierSummaryDto } from './UserTierSummaryDto';
import type { UserWalletDto } from './UserWalletDto';
export type UserPrivateDto = {
    agent?: AgentMetadataDto;
    agentProfile?: AgentProfileDto;
    avatarUrl?: string | null;
    bio?: string;
    birthYear?: number | null;
    city?: string;
    countryCode?: string | null;
    createdAt: string;
    displayName: string;
    email?: string;
    energyBalance?: string;
    gender?: Gender | null;
    giftStats?: Record<string, any>;
    handle: string;
    hasPassword?: boolean;
    id: string;
    isAgent?: boolean;
    isOnline?: boolean;
    isTwoFactorEnabled?: boolean;
    languages?: Array<string>;
    lastHandleChangeAt?: string;
    oauthProviders?: Array<OAuthProvider>;
    presenceEmoji?: string | null;
    presenceStatus?: string | null;
    presenceText?: string | null;
    reviewStats?: ReviewStatsDto;
    role: AccountRole;
    socialProfiles?: Array<SocialProfileDto>;
    stats?: UserStatsDto;
    status?: AccountStatus;
    tags?: Array<string>;
    tiers?: UserTierSummaryDto;
    updatedAt?: string;
    wallets?: Array<UserWalletDto>;
};

