import type { Message } from '@earendil-works/pi-ai';

/** Leave room for the next user input, tool results, and the native request envelope. */
export function needsCompaction(messages: readonly Message[]): boolean {
  if (messages.length >= 96) return true;
  const json = JSON.stringify(messages, function (this: { type?: string }, key, value) {
    // Images become owned Artifact references at the Nimi boundary.
    return key === 'data' && this.type === 'image' ? '[uploaded Nimi artifact]' : value;
  });
  return Buffer.byteLength(json, 'utf8') >= 256 * 1024;
}
