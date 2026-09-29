// Follow-ups accept typed private-chat IDs only; this reads them line by line so
// each problem is reported at its own line before anything is sent.
export const MAX_FOLLOWUP_RECIPIENTS = 20;
const MAX_LABEL_LENGTH = 100;

export type RecipientProblemReason = 'username' | 'group-or-channel' | 'not-numeric' | 'duplicate' | 'too-many' | 'name-too-long';
export type RecipientProblem = { readonly line: number; readonly value: string; readonly reason: RecipientProblemReason };
export type ParsedRecipient = { readonly line: number; readonly chatId: string; readonly label: string; readonly named: boolean };
export type ParsedRecipients = { readonly recipients: readonly ParsedRecipient[]; readonly problems: readonly RecipientProblem[] };

export function parseRecipientLines(text: string, fallbackLabel: (index: number) => string): ParsedRecipients {
  const recipients: ParsedRecipient[] = [];
  const problems: RecipientProblem[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const [chatId = '', ...words] = trimmed.split(/\s+/u);
    const label = words.join(' ');
    const problem = (reason: RecipientProblemReason, value = chatId) => { problems.push({ line, value, reason }); };
    if (chatId.startsWith('@')) problem('username');
    else if (/^-\d+$/u.test(chatId)) problem('group-or-channel');
    else if (!/^[1-9][0-9]{0,19}$/u.test(chatId)) problem('not-numeric');
    else if (seen.has(chatId)) problem('duplicate');
    else if (label.length > MAX_LABEL_LENGTH) problem('name-too-long', label);
    else if (recipients.length >= MAX_FOLLOWUP_RECIPIENTS) problem('too-many');
    else {
      seen.add(chatId);
      recipients.push({ line, chatId, label: label || fallbackLabel(recipients.length + 1), named: Boolean(label) });
    }
  });
  return { recipients, problems };
}
