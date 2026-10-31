import type { NimiRealmTransferredFile } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@nimiplatform/sdk/types';
import type { DesktopRendererOfflinePort } from '../../renderer/offline-port.js';
import type { PersistentOutboxEntry } from '../../infra/offline/types.js';

export type HumanSendAttachment = { readonly file: File; readonly name: string; readonly submissionRequestId?: string };
export type HumanSendPorts<T> = {
  offline: DesktopRendererOfflinePort;
  peerAccountId: string;
  chatId: string;
  isCurrent(): boolean;
  newId(): string;
  now(): number;
  upload(attachment: HumanSendAttachment, transferred: (file: NimiRealmTransferredFile) => Promise<void>): Promise<JsonObject>;
  finalize(file: NimiRealmTransferredFile): Promise<JsonObject>;
  send(entry: PersistentOutboxEntry): Promise<T>;
  confirmed(entry: PersistentOutboxEntry, message: T, attachment?: HumanSendAttachment): void | Promise<void>;
  changed(): void;
};

/** Explicit retries of this person's send intent; never an automatic outbox drain. */
// @nimi-authority: rule.nimi.desktop.shell-runtime.r010
export function createHumanChatSender<T>(ports: HumanSendPorts<T>) {
  const entries = new Map<string, PersistentOutboxEntry>();
  const files = new Map<string, HumanSendAttachment>();
  let busy = false;
  function current() {
    if (!ports.isCurrent()) throw new Error('HUMAN_CHAT_ACCOUNT_CHANGED');
    ports.offline.capture();
  }
  async function persist(entry: PersistentOutboxEntry) {
    current();
    await ports.offline.upsertChatOutboxEntry(entry);
    current();
    entries.set(entry.clientMessageId, entry); ports.changed();
  }
  async function dispatch(entry: PersistentOutboxEntry): Promise<void> {
    current();
    let pending = entry;
    const attachment = files.get(entry.clientMessageId);
    if (entry.body.uploadNeeded === true) {
      let payload: JsonObject;
      if (entry.transferredFile) {
        payload = await ports.finalize(entry.transferredFile);
      } else {
        if (!attachment) throw new Error('HUMAN_CHAT_ATTACHMENT_RESELECT_REQUIRED');
        payload = await ports.upload({ ...attachment, submissionRequestId: entry.clientMessageId },
          transferredFile => persist({ ...entry, transferredFile }));
      }
      current();
      pending = { ...entry, body: { type: 'ATTACHMENT', payload, attachmentName: entry.body.attachmentName }, failReason: undefined };
      await persist(pending);
    }
    pending = { ...pending, attempts: pending.attempts + 1, status: 'pending', failReason: undefined };
    await persist(pending);
    let message: T;
    try {
      message = await ports.send(pending);
    } catch (error) {
      current();
      // A transport error may follow a committed server write. Keep the same ID.
      await persist({ ...pending, failReason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    current();
    // Keep the stable send ID until its matching draft has been durably cleared.
    await ports.confirmed(pending, message, attachment);
    current();
    await ports.offline.removeChatOutboxEntry(pending.clientMessageId);
    current();
    entries.delete(pending.clientMessageId); files.delete(pending.clientMessageId);
    ports.changed();
  }
  async function retry(shouldAttempt: (entry: PersistentOutboxEntry) => boolean = () => true) {
    if (busy) return;
    current(); busy = true; ports.changed();
    try {
      for (const entry of [...entries.values()]) if (shouldAttempt(entry)) await dispatch(entry);
    } finally { busy = false; if (ports.isCurrent()) ports.changed(); }
  }
  return {
    get busy() { return busy; },
    pending: () => [...entries.values()],
    async restore(attachments: readonly HumanSendAttachment[] = []) {
      const stored = await ports.offline.getChatOutboxEntries();
      current();
      for (const entry of stored) if (entry.peerAccountId === ports.peerAccountId && entry.chatId === ports.chatId) entries.set(entry.clientMessageId, entry);
      for (const attachment of attachments) if (attachment.submissionRequestId && entries.has(attachment.submissionRequestId)) files.set(attachment.submissionRequestId, attachment);
      ports.changed();
    },
    async submit(text: string, attachments: readonly HumanSendAttachment[]) {
      current();
      if (busy || entries.size) throw new Error('HUMAN_CHAT_PENDING_SEND_REQUIRES_RETRY');
      busy = true; ports.changed();
      try {
        const start = ports.now();
        const queue: PersistentOutboxEntry[] = [];
        for (const attachment of attachments) {
          const id = attachment.submissionRequestId ?? ports.newId(); files.set(id, attachment);
          queue.push({ clientMessageId: id, chatId: ports.chatId, peerAccountId: ports.peerAccountId,
            body: { type: 'ATTACHMENT', uploadNeeded: true, attachmentName: attachment.name },
            enqueuedAt: start + queue.length, attempts: 0, status: 'pending' });
        }
        if (text.trim()) queue.push({ clientMessageId: ports.newId(), chatId: ports.chatId, peerAccountId: ports.peerAccountId,
          body: { type: 'TEXT', text: text.trim(), payload: { content: text.trim() } },
          enqueuedAt: start + queue.length, attempts: 0, status: 'pending' });
        for (const entry of queue) await persist(entry);
        for (const entry of queue) await dispatch(entry);
      } finally { busy = false; if (ports.isCurrent()) ports.changed(); }
    },
    retry,
    async stopRetrying() {
      if (busy) return;
      current();
      for (const entry of [...entries.values()]) {
        await ports.offline.removeChatOutboxEntry(entry.clientMessageId); current();
        entries.delete(entry.clientMessageId); files.delete(entry.clientMessageId);
      }
      ports.changed();
    },
    /** Only an attachment that never reached message dispatch can be discarded. */
    async discardUnuploaded(id: string) {
      const entry = entries.get(id);
      if (busy || !entry || entry.body.uploadNeeded !== true || entry.attempts !== 0) return;
      current(); await ports.offline.removeChatOutboxEntry(id); current();
      entries.delete(id); files.delete(id); ports.changed();
    },
  };
}
