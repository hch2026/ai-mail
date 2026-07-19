import { ImapFlow, type FetchMessageObject } from "imapflow";

import type { AppConfig } from "../config/env.js";
import { chunkUids, summarizeMimeTree, type BodyStructureNode } from "./mime.js";
import type {
  BodyPartContent,
  FlagUpdate,
  ImapConnection,
  ImapMessageMetadata,
  MailboxMoveRequest,
  MailboxMoveResult,
  ReadOnlyMailboxSession,
} from "./types.js";

function stringSet(value: Set<string> | undefined): string[] {
  return value ? [...value].sort() : [];
}

function toMetadata(message: FetchMessageObject): ImapMessageMetadata {
  const envelope = message.envelope;
  const sender = envelope?.from?.[0];
  const mime = summarizeMimeTree(message.bodyStructure as BodyStructureNode | undefined);
  const flags = stringSet(message.flags);
  return {
    uid: message.uid,
    messageId: envelope?.messageId ?? null,
    fromName: sender?.name ?? null,
    fromAddress: sender?.address ?? null,
    subject: envelope?.subject ?? null,
    sentAt: envelope?.date ? new Date(envelope.date) : null,
    internalDate: message.internalDate ? new Date(message.internalDate) : null,
    size: message.size ?? null,
    flags,
    imapLabels: stringSet(message.labels),
    isUnread: !flags.includes("\\Seen"),
    textPart: mime.textPart,
    htmlPart: mime.htmlPart,
    attachments: mime.attachments,
  };
}

export class ImapFlowMailboxSession implements ReadOnlyMailboxSession {
  public readonly snapshot;

  public constructor(private readonly client: ImapFlow, path: string) {
    if (!client.mailbox || !client.mailbox.readOnly) {
      throw new Error("IMAP mailbox must be open read-only");
    }
    this.snapshot = {
      path,
      uidValidity: client.mailbox.uidValidity.toString(),
      highestModseq: client.mailbox.highestModseq?.toString() ?? null,
    };
  }

  public async searchNewUids(afterUid: number): Promise<number[]> {
    const query = afterUid > 0 ? { uid: `${afterUid + 1}:*` } : { all: true };
    const uids = await this.client.search(query, { uid: true });
    if (!uids) return [];
    return uids.filter((uid: number) => uid > afterUid).sort((a: number, b: number) => a - b);
  }

  public async fetchMetadata(uids: number[]): Promise<ImapMessageMetadata[]> {
    if (uids.length === 0) return [];
    const gmailLabels = this.client.capabilities.has("X-GM-EXT-1");
    const query = {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
      ...(gmailLabels ? { labels: true } : {}),
    };
    const messages = await this.client.fetchAll(uids, query, { uid: true });
    return messages.map(toMetadata);
  }

  public async fetchChangedFlags(changedSince: string): Promise<FlagUpdate[]> {
    const updates: FlagUpdate[] = [];
    const gmailLabels = this.client.capabilities.has("X-GM-EXT-1");
    for await (const message of this.client.fetch(
      "1:*",
      { uid: true, flags: true, ...(gmailLabels ? { labels: true } : {}) },
      { uid: true, changedSince: BigInt(changedSince) },
    )) {
      updates.push({
        uid: message.uid,
        flags: stringSet(message.flags),
        labels: stringSet(message.labels),
      });
    }
    return updates;
  }

  public async fetchAllFlags(pageSize: number): Promise<FlagUpdate[]> {
    const found = await this.client.search({ all: true }, { uid: true });
    if (!found) return [];
    const updates: FlagUpdate[] = [];
    const gmailLabels = this.client.capabilities.has("X-GM-EXT-1");
    for (const page of chunkUids(found, pageSize)) {
      const messages = await this.client.fetchAll(
        page,
        { uid: true, flags: true, ...(gmailLabels ? { labels: true } : {}) },
        { uid: true },
      );
      for (const message of messages) {
        updates.push({ uid: message.uid, flags: stringSet(message.flags), labels: stringSet(message.labels) });
      }
    }
    return updates;
  }

  public async fetchBodyPart(uid: number, part: string, maxBytes: number): Promise<BodyPartContent> {
    // ImapFlow download() retrieves BODY.PEEK[part] and does not set \Seen.
    const download = await this.client.download(uid.toString(), part, { uid: true, maxBytes });
    const chunks: Buffer[] = [];
    for await (const chunk of download.content) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      content: Buffer.concat(chunks),
      contentType: download.meta.contentType,
      charset: download.meta.charset ?? null,
    };
  }
}

export class ImapFlowConnection implements ImapConnection {
  private readonly client: ImapFlow;

  public constructor(private readonly config: AppConfig) {
    this.client = new ImapFlow({
      host: config.MAIL_IMAP_HOST,
      port: config.MAIL_IMAP_PORT,
      secure: config.MAIL_IMAP_SECURE,
      auth: { user: config.MAIL_EMAIL, pass: config.MAIL_AUTH_CODE },
      logger: false,
      clientInfo: { name: "ai-mail", version: "0.1.0", vendor: "local" },
      maxIdleTime: 4 * 60 * 1000,
      connectionTimeout: 30_000,
      greetingTimeout: 20_000,
      socketTimeout: 5 * 60 * 1000,
    });
    // Keep transport errors from becoming unhandled EventEmitter errors;
    // waitForChange still attaches a scoped listener to trigger reconnects.
    this.client.on("error", () => undefined);
  }

  public async connect(): Promise<void> {
    await this.client.connect();
  }

  public async close(): Promise<void> {
    if (!this.client.usable) return;
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }

  public async withReadOnlyMailbox<T>(
    callback: (session: ReadOnlyMailboxSession) => Promise<T>,
  ): Promise<T> {
    const lock = await this.client.getMailboxLock(this.config.MAIL_MAILBOX, {
      readOnly: true,
      description: "ai-mail read-only sync",
    });
    try {
      return await callback(new ImapFlowMailboxSession(this.client, this.config.MAIL_MAILBOX));
    } finally {
      lock.release();
    }
  }

  public async moveMessagesToTrash(input: MailboxMoveRequest): Promise<MailboxMoveResult> {
    return moveMessagesToTrash(this.client, input);
  }

  public async waitForChange(timeoutMs: number): Promise<boolean> {
    if (!this.client.usable) throw new Error("IMAP connection is closed");
    return await new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timer);
        this.client.off("exists", onExists);
        this.client.off("close", onClose);
        this.client.off("error", onError);
      };
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onExists = (): void => finish(true);
      const onClose = (): void => fail(new Error("IMAP connection closed while idling"));
      const onError = (error: Error): void => fail(error);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.client.once("exists", onExists);
      this.client.once("close", onClose);
      this.client.once("error", onError);
      // ImapFlow enters IDLE automatically whenever no command is active.
    });
  }
}

export async function moveMessagesToTrash(
  client: ImapFlow,
  input: MailboxMoveRequest,
): Promise<MailboxMoveResult> {
  if (!client.usable) throw new Error("IMAP connection is closed");
  const mailboxes = await client.list();
  const trash = mailboxes.find((mailbox) => mailbox.specialUse === "\\Trash")
    ?? mailboxes.find((mailbox) => isKnownTrashPath(mailbox.path));
  if (!trash) throw new Error("The IMAP server did not expose a recoverable trash mailbox");
  if (trash.path.toLowerCase() === input.mailbox.toLowerCase()) {
    throw new Error("Source mailbox is already the trash mailbox");
  }

  const lock = await client.getMailboxLock(input.mailbox, {
    readOnly: false,
    description: "ai-mail user-confirmed move to trash",
  });
  try {
    if (!client.mailbox || client.mailbox.readOnly) {
      throw new Error("IMAP mailbox must be open read-write for a confirmed delete");
    }
    if (client.mailbox.uidValidity.toString() !== input.uidValidity) {
      throw new Error("UIDVALIDITY changed before deletion; refresh and select the messages again");
    }
    const found = await client.search({ uid: input.uids.join(",") }, { uid: true });
    const foundUids = [...new Set(found || [])].sort((a, b) => a - b);
    if (foundUids.length !== input.uids.length) {
      throw new Error("Some selected messages no longer exist in the source mailbox");
    }
    const result = await client.messageMove(foundUids, trash.path, { uid: true });
    if (!result) throw new Error("The IMAP server rejected the move to trash");
    return { moved: foundUids.length, targetMailbox: trash.path };
  } finally {
    lock.release();
  }
}

function isKnownTrashPath(path: string): boolean {
  const leaf = path.normalize("NFKC").split(/[/.]/).at(-1)?.trim().toLowerCase() ?? "";
  return new Set(["已删除", "已删除邮件", "垃圾箱", "废纸篓", "trash", "deleted", "deleted messages"]).has(leaf);
}
