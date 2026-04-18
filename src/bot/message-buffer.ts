/**
 * message-buffer.ts
 *
 * In-memory ring buffer of recent WAMessages keyed by group JID.
 * Provides O(1) lookup by (remoteJid, id) for Baileys' getMessage callback.
 * Loss on restart is acceptable — no persistence layer.
 */

import type { WAMessage } from "@whiskeysockets/baileys";

const BUFFER_CAP = 30;

export class MessageBuffer {
  private readonly store = new Map<string, WAMessage[]>();

  /**
   * Add a message to the buffer for its group JID.
   * If the buffer for that group exceeds BUFFER_CAP, the oldest message is evicted.
   */
  push(msg: WAMessage): void {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    if (!this.store.has(jid)) {
      this.store.set(jid, []);
    }
    const arr = this.store.get(jid)!;
    arr.push(msg);
    if (arr.length > BUFFER_CAP) {
      arr.shift(); // evict oldest
    }
  }

  /**
   * Return the last `n` messages for a group JID.
   * Returns an empty array if the group has no buffered messages.
   */
  getRecent(groupJid: string, n: number): WAMessage[] {
    const arr = this.store.get(groupJid);
    if (!arr || arr.length === 0) return [];
    return arr.slice(-n);
  }

  /**
   * Look up a specific message by { remoteJid, id }.
   * Used by Baileys' getMessage config callback — returns the proto.IMessage
   * body (i.e. WAMessage.message), not the full wrapper.
   *
   * Returns undefined if the message is not found in the buffer.
   */
  getMessage(
    key: { remoteJid?: string | null; id?: string | null }
  ): WAMessage | undefined {
    const { remoteJid, id } = key;
    if (!remoteJid || !id) return undefined;
    const arr = this.store.get(remoteJid);
    if (!arr) return undefined;
    return arr.find((m) => m.key.id === id);
  }
}
