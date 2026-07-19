import type { AttachmentMetadata } from "./types.js";

export interface BodyStructureNode {
  part?: string;
  type?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  size?: number;
  id?: string;
  childNodes?: BodyStructureNode[];
}

export interface MimeSummary {
  textPart: string | null;
  htmlPart: string | null;
  attachments: AttachmentMetadata[];
}

export function summarizeMimeTree(root: BodyStructureNode | undefined): MimeSummary {
  const result: MimeSummary = { textPart: null, htmlPart: null, attachments: [] };
  if (!root) return result;

  const visit = (node: BodyStructureNode, inferredPart: string | null): void => {
    const type = (node.type ?? "application/octet-stream").toLowerCase();
    // IMAP servers commonly omit `part` on a single-part root BODYSTRUCTURE.
    // RFC body section numbering still addresses that payload as part "1".
    const part = node.part ?? (type.startsWith("multipart/") ? null : inferredPart);
    const disposition = node.disposition?.toLowerCase();
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
    const isAttachment = Boolean(part) && (
      disposition === "attachment" ||
      disposition === "inline" ||
      filename !== null ||
      (!type.startsWith("text/") && !type.startsWith("multipart/"))
    );

    if (isAttachment) {
      result.attachments.push({
        filename,
        contentType: type,
        size: node.size ?? null,
        part,
        contentId: node.id ?? null,
        disposition: disposition === "attachment" || disposition === "inline" ? disposition : "unknown",
      });
    } else if (part && type === "text/plain" && result.textPart === null) {
      result.textPart = part;
    } else if (part && type === "text/html" && result.htmlPart === null) {
      result.htmlPart = part;
    }

    const parentPart = node.part ?? inferredPart;
    for (const [index, child] of (node.childNodes ?? []).entries()) {
      const childPart = parentPart ? `${parentPart}.${index + 1}` : `${index + 1}`;
      visit(child, childPart);
    }
  };
  visit(root, root.type?.toLowerCase().startsWith("multipart/") ? null : "1");
  return result;
}

export function chunkUids(uids: number[], pageSize: number): number[][] {
  const pages: number[][] = [];
  for (let index = 0; index < uids.length; index += pageSize) {
    pages.push(uids.slice(index, index + pageSize));
  }
  return pages;
}
