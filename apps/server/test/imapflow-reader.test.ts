import type { ImapFlow } from "imapflow";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { ImapFlowMailboxSession, moveMessagesToTrash } from "../src/imap/imapflow-reader.js";

describe("ImapFlowMailboxSession", () => {
  it("downloads a body part through ImapFlow PEEK semantics without changing unread state", async () => {
    let remoteUnread = true;
    const download = vi.fn(async () => ({
      content: Readable.from([Buffer.from("read-only body")]),
      meta: { contentType: "text/plain", charset: "utf-8" },
    }));
    const fetchAll = vi.fn(async () => [{
      uid: 7,
      flags: new Set<string>(remoteUnread ? [] : ["\\Seen"]),
      labels: new Set<string>(),
      envelope: { subject: "Still unread", from: [], date: new Date("2025-01-01T00:00:00.000Z") },
      internalDate: new Date("2025-01-01T00:00:00.000Z"),
      size: 100,
      bodyStructure: undefined,
    }]);
    const client = {
      mailbox: { readOnly: true, uidValidity: 99n, highestModseq: null },
      capabilities: new Set<string>(),
      download,
      fetchAll,
    } as unknown as ImapFlow;
    const session = new ImapFlowMailboxSession(client, "INBOX");

    expect((await session.fetchMetadata([7]))[0]?.isUnread).toBe(true);
    const body = await session.fetchBodyPart(7, "1", 1024);
    expect(body.content.toString()).toBe("read-only body");
    expect(download).toHaveBeenCalledWith("7", "1", { uid: true, maxBytes: 1024 });
    expect(remoteUnread).toBe(true);
    expect((await session.fetchMetadata([7]))[0]?.isUnread).toBe(true);
  });

  it("refuses to operate unless the mailbox is opened read-only", () => {
    const client = {
      mailbox: { readOnly: false, uidValidity: 99n, highestModseq: null },
    } as unknown as ImapFlow;
    expect(() => new ImapFlowMailboxSession(client, "INBOX")).toThrow("open read-only");
  });

  it("moves only verified UIDs into the server trash without permanent expunge", async () => {
    const release = vi.fn();
    const messageMove = vi.fn(async () => ({ path: "已删除" }));
    const client = {
      usable: true,
      mailbox: { readOnly: false, uidValidity: 99n },
      list: vi.fn(async () => [{ path: "INBOX", specialUse: "\\Inbox" }, { path: "已删除", specialUse: "\\Trash" }]),
      getMailboxLock: vi.fn(async () => ({ release })),
      search: vi.fn(async () => [7, 8]),
      messageMove,
    } as unknown as ImapFlow;

    await expect(moveMessagesToTrash(client, {
      mailbox: "INBOX",
      uidValidity: "99",
      uids: [7, 8],
    })).resolves.toEqual({ moved: 2, targetMailbox: "已删除" });
    expect(messageMove).toHaveBeenCalledWith([7, 8], "已删除", { uid: true });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("refuses deletion when UIDVALIDITY changed", async () => {
    const release = vi.fn();
    const messageMove = vi.fn();
    const client = {
      usable: true,
      mailbox: { readOnly: false, uidValidity: 100n },
      list: vi.fn(async () => [{ path: "已删除", specialUse: "\\Trash" }]),
      getMailboxLock: vi.fn(async () => ({ release })),
      search: vi.fn(async () => [7]),
      messageMove,
    } as unknown as ImapFlow;

    await expect(moveMessagesToTrash(client, {
      mailbox: "INBOX",
      uidValidity: "99",
      uids: [7],
    })).rejects.toThrow("UIDVALIDITY changed");
    expect(messageMove).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
