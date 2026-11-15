/** A Home shortcut draft belongs to one account and one view-local partner. */
// @nimi-authority: rule.nimi.desktop.agent-projection.composer-draft
export function homePartnerDraftKey(accountId: string, partnerRef: string): string | null {
  return accountId && partnerRef ? JSON.stringify([accountId, partnerRef]) : null;
}
