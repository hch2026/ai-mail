import { describe, expect, it } from "vitest";

import { chunkUids, summarizeMimeTree } from "../src/imap/mime.js";

describe("summarizeMimeTree", () => {
  it("infers part 1 for a single-part root returned without a part number", () => {
    const summary = summarizeMimeTree({
      type: "text/plain",
      parameters: { charset: "UTF-8" },
      size: 938,
    });

    expect(summary.textPart).toBe("1");
    expect(summary.htmlPart).toBeNull();
    expect(summary.attachments).toEqual([]);
  });

  it("selects inline text and records attachments without content", () => {
    const summary = summarizeMimeTree({
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain", size: 500 },
        { part: "2", type: "text/html", size: 900 },
        {
          part: "3",
          type: "application/pdf",
          size: 42_000,
          disposition: "attachment",
          dispositionParameters: { filename: "invoice.pdf" },
        },
      ],
    });

    expect(summary.textPart).toBe("1");
    expect(summary.htmlPart).toBe("2");
    expect(summary.attachments).toEqual([
      {
        filename: "invoice.pdf",
        contentType: "application/pdf",
        size: 42_000,
        part: "3",
        contentId: null,
        disposition: "attachment",
      },
    ]);
  });

  it("keeps inline image part and content id for read-only rendering", () => {
    const summary = summarizeMimeTree({
      type: "multipart/related",
      childNodes: [
        { part: "1", type: "text/html" },
        { part: "2", type: "image/png", id: "<hero@example>", disposition: "inline", size: 123 },
      ],
    });

    expect(summary.attachments[0]).toMatchObject({
      part: "2",
      contentId: "<hero@example>",
      contentType: "image/png",
      disposition: "inline",
    });
  });
});

describe("chunkUids", () => {
  it("paginates a first sync", () => {
    expect(chunkUids([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
