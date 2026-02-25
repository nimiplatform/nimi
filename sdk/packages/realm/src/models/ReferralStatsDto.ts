/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { InviteeDto } from './InviteeDto';
export type ReferralStatsDto = {
    /**
     * List of invited users
     */
    invitees: Array<InviteeDto>;
    /**
     * Number of codes that have been used
     */
    successfulInvites: number;
    /**
     * Total Spark bonus earned from referrals
     */
    totalBonusEarned: string;
    /**
     * Total number of invite codes created
     */
    totalInvites: number;
};

