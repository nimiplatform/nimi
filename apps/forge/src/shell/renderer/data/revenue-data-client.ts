/**
 * Revenue Data Client — Forge adapter (FG-REV-001..005)
 *
 * Direct SDK realm client calls for economy/revenue operations.
 */

import { getPlatformClient } from '@runtime/platform-client.js';

function realm() {
  return getPlatformClient().realm;
}

// ── Balances ─────────────────────────────────────────────────

export async function getBalances() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetBalances();
}

// ── Spark / Gem History ──────────────────────────────────────

export async function getSparkHistory() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetSparkHistory();
}

export async function getGemHistory() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetGemHistory();
}

// ── Revenue Share ────────────────────────────────────────────

export async function getRevenueShareConfig() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetRevenueShareConfig();
}

export async function getAgentOrigin(agentId: string) {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetAgentOrigin(agentId);
}

export async function previewRevenueDistribution(amount: string, agentId: string) {
  return realm().services.EconomyCurrencyGiftsService.economyControllerPreviewRevenueDistribution(amount, agentId);
}

// ── Stripe Connect ───────────────────────────────────────────

export async function getConnectStatus() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetConnectStatus();
}

export async function createConnectOnboarding(payload: Record<string, unknown>) {
  return realm().services.EconomyCurrencyGiftsService.economyControllerCreateConnectOnboarding(payload);
}

export async function createConnectDashboard() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerCreateConnectDashboard();
}

// ── Withdrawals ──────────────────────────────────────────────

export async function getWithdrawalConfig() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetWithdrawalConfig();
}

export async function canWithdraw() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerCanWithdraw();
}

export async function calculateWithdrawal(amount: string) {
  return realm().services.EconomyCurrencyGiftsService.economyControllerCalculateWithdrawal(amount);
}

export async function createWithdrawal(payload: Record<string, unknown>) {
  return realm().services.EconomyCurrencyGiftsService.economyControllerCreateWithdrawal(payload);
}

export async function getWithdrawalHistory() {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetWithdrawalHistory();
}

export async function getWithdrawal(id: string) {
  return realm().services.EconomyCurrencyGiftsService.economyControllerGetWithdrawal(id);
}
