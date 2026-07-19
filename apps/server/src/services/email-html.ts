import sanitizeHtml from "sanitize-html";

export interface SanitizedEmailHtml {
  html: string;
  remoteImageCount: number;
  inlineImageCount: number;
}

function normalizeContentId(value: string): string {
  return value.trim().replace(/^<|>$/g, "").toLowerCase();
}

function isRemoteImage(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isSafeDataImage(value: string): boolean {
  return /^data:image\/(?:png|gif|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value.trim());
}

export function sanitizeEmailHtml(
  input: string,
  inlineImages: ReadonlyMap<string, string> = new Map(),
): SanitizedEmailHtml {
  let remoteImageCount = 0;
  let inlineImageCount = 0;
  const normalizedInlineImages = new Map(
    [...inlineImages].map(([contentId, dataUrl]) => [normalizeContentId(contentId), dataUrl]),
  );

  const html = sanitizeHtml(input, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "colgroup",
      "col",
    ],
    allowedAttributes: {
      "*": ["class", "style", "title", "dir", "lang", "role", "aria-label"],
      img: [
        "src",
        "data-remote-src",
        "alt",
        "title",
        "width",
        "height",
        "loading",
        "referrerpolicy",
      ],
      table: ["width", "height", "border", "cellpadding", "cellspacing", "align"],
      td: ["width", "height", "colspan", "rowspan", "align", "valign", "bgcolor"],
      th: ["width", "height", "colspan", "rowspan", "align", "valign", "bgcolor"],
      col: ["width", "span"],
    },
    allowedSchemesByTag: { img: ["data"] },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
        "text-align": [/^(?:left|right|center|justify)$/],
        "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/],
        "font-weight": [/^(?:normal|bold|bolder|lighter|[1-9]00)$/],
        "font-style": [/^(?:normal|italic|oblique)$/],
        "text-decoration": [/^(?:none|underline|line-through)$/],
        width: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        "max-width": [/^(?:none|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        height: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        display: [/^(?:block|inline|inline-block|table|table-row|table-cell|none)$/],
        margin: [/^[\d\s.%a-z-]+$/i],
        padding: [/^[\d\s.%a-z-]+$/i],
        border: [/^[\d\s#a-z().,%/-]+$/i],
        "border-collapse": [/^(?:collapse|separate)$/],
        "line-height": [/^(?:normal|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        "white-space": [/^(?:normal|nowrap|pre|pre-wrap)$/],
      },
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "span",
        attribs: {
          ...(attribs.title ? { title: attribs.title } : {}),
          class: "mail-link-text",
        },
      }),
      img: (_tagName, attribs) => {
        const source = attribs.src?.trim() ?? "";
        const next: Record<string, string> = {
          ...attribs,
          loading: "lazy",
          referrerpolicy: "no-referrer",
        };
        delete next.src;
        delete next.srcset;

        if (/^cid:/i.test(source)) {
          const dataUrl = normalizedInlineImages.get(normalizeContentId(source.slice(4)));
          if (dataUrl && isSafeDataImage(dataUrl)) {
            next.src = dataUrl;
            inlineImageCount += 1;
          }
        } else if (isSafeDataImage(source)) {
          next.src = source;
          inlineImageCount += 1;
        } else if (isRemoteImage(source)) {
          next["data-remote-src"] = source;
          remoteImageCount += 1;
        }

        return { tagName: "img", attribs: next };
      },
    },
    disallowedTagsMode: "discard",
  });

  return { html, remoteImageCount, inlineImageCount };
}
