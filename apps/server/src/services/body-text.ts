import { convert } from "html-to-text";
import { simpleParser } from "mailparser";

import type { BodyPartContent } from "../imap/types.js";

function safeToken(value: string | null, fallback: string): string {
  return value && /^[a-zA-Z0-9._+/-]+$/.test(value) ? value : fallback;
}

async function parseBodyPart(part: BodyPartContent) {
  const contentType = part.contentType.toLowerCase() === "text/html" ? "text/html" : "text/plain";
  const charset = safeToken(part.charset, "utf-8");
  const syntheticMessage = Buffer.concat([
    Buffer.from(`Content-Type: ${contentType}; charset="${charset}"\r\nContent-Transfer-Encoding: 8bit\r\n\r\n`),
    part.content,
  ]);
  return simpleParser(syntheticMessage, {
    skipHtmlToText: true,
    skipTextToHtml: true,
  });
}

export async function parseBodyPartAsSafeText(part: BodyPartContent): Promise<string> {
  const parsed = await parseBodyPart(part);
  let text = parsed.text ?? "";
  if (!text && typeof parsed.html === "string") {
    text = convert(parsed.html, {
      wordwrap: false,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
      ],
    });
  }
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 200_000);
}

export async function parseBodyPartAsHtml(part: BodyPartContent): Promise<string | null> {
  if (part.contentType.toLowerCase() !== "text/html") return null;
  const parsed = await parseBodyPart(part);
  return typeof parsed.html === "string" ? parsed.html.slice(0, 2_000_000) : null;
}
