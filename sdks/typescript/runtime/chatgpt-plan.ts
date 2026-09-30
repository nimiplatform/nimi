// The ChatGPT plan route is the only Cloud provider whose usage is billed to
// the signed-in person's ChatGPT plan; consumers disclose that near model
// choice and link to OpenAI's usage settings.
export const NIMI_CHATGPT_PLAN_PROVIDER = 'openai_chatgpt_plan';
export const NIMI_CHATGPT_PLAN_USAGE_URL = 'https://chatgpt.com/settings/usage';
// Runtime action hints for the plan's usage limit and for a sign-in that ended
// and must be renewed by explicit reauthorization.
export const NIMI_CHATGPT_PLAN_MANAGE_USAGE_ACTION_HINT = 'manage_chatgpt_plan_usage';
export const NIMI_CHATGPT_PLAN_REAUTHORIZE_ACTION_HINT = 'reauthorize_chatgpt_plan_connector';
// A deleted plan Connector whose remote sign-out OpenAI did not confirm.
export const NIMI_CHATGPT_PLAN_REVOCATION_UNCONFIRMED_ACTION_HINT = 'chatgpt_plan_revocation_unconfirmed';

export function nimiProviderUsesChatGPTPlan(provider: string | undefined): boolean {
  return String(provider || '').trim().toLowerCase() === NIMI_CHATGPT_PLAN_PROVIDER;
}
