/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { PublicFilterDto } from './PublicFilterDto';
import type { Visibility } from './Visibility';
export type UpdateUserSettingsDto = {
    accountVisibility?: Visibility;
    blockedAccountIds?: Array<string>;
    defaultPostVisibility?: Visibility;
    dmVisibility?: Visibility;
    friendListVisibility?: Visibility;
    friendRequestVisibility?: Visibility;
    mentionVisibility?: Visibility;
    notificationSettings?: Record<string, any>;
    /**
     * Allow NSFW interactions with AI agents
     */
    nsfwChatEnabled?: boolean;
    onlineStatusVisibility?: Visibility;
    presenceEmoji?: string;
    presenceStatus?: string;
    presenceText?: string;
    profileVisibility?: Visibility;
    publicFilter?: PublicFilterDto;
    /**
     * Allow viewing of R18/Sensitive content
     */
    showSensitiveContent?: boolean;
    socialVisibility?: Visibility;
    walletSecurityChallengeEnabled?: boolean;
    walletVisibility?: Visibility;
};

