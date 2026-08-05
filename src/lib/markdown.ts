import { marked } from "marked";

// GFM gives us tables, strikethrough and task lists; breaks keeps single
// newlines as <br> (closer to how people type in a textarea). Raw inline HTML
// is passed through so colored spans / <mark> highlights render.
marked.use({ gfm: true, breaks: true });

export function renderMarkdown(md: string | null | undefined): string {
  return marked.parse(md ?? "", { async: false }) as string;
}

/* ------------------------------------------------------------------ */
/*  HTML -> Markdown (used by the summary paste handler)              */
/*  Handles the tags Word/Docs/most editors emit, and preserves       */
/*  colour + highlight as inline HTML so nothing visual is lost.      */
/* ------------------------------------------------------------------ */

function inlineStyleWrap(el: HTMLElement, inner: string): string {
  if (!inner.trim()) return inner;
  const style = el.style;
  let out = inner;

  const weight = style.fontWeight;
  if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) out = `**${out}**`;
  if (style.fontStyle === "italic") out = `_${out}_`;
  if (style.textDecorationLine?.includes("line-through")) out = `~~${out}~~`;
  if (style.textDecorationLine?.includes("underline")) out = `<u>${out}</u>`;

  const color = style.color;
  const bg = style.backgroundColor;
  if (bg && bg !== "transparent" && !/rgba?\(0, 0, 0, 0\)/.test(bg)) {
    out = `<mark style="background:${bg}">${out}</mark>`;
  }
  if (color) out = `<span style="color:${color}">${out}</span>`;
  return out;
}

function cellText(el: Element): string {
  return serializeChildren(el).replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").trim();
}

function tableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return "";
  const grid = rows.map((tr) => Array.from(tr.children).map((c) => cellText(c)));
  const cols = Math.max(...grid.map((r) => r.length));
  const pad = (r: string[]) => {
    const copy = [...r];
    while (copy.length < cols) copy.push("");
    return copy;
  };
  const header = pad(grid[0]);
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const r of grid.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
  return `\n${lines.join("\n")}\n\n`;
}

function serializeChildren(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => (out += serializeNode(child)));
  return out;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // Collapse runs of whitespace (incl. newlines) the way HTML would.
    return (node.textContent ?? "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = () => serializeChildren(el);

  switch (tag) {
    case "h1": return `\n# ${inner().trim()}\n\n`;
    case "h2": return `\n## ${inner().trim()}\n\n`;
    case "h3": return `\n### ${inner().trim()}\n\n`;
    case "h4": case "h5": case "h6": return `\n#### ${inner().trim()}\n\n`;
    case "p": case "div": {
      const t = inlineStyleWrap(el, inner()).trim();
      return t ? `${t}\n\n` : "";
    }
    case "br": return "\n";
    case "hr": return `\n---\n\n`;
    case "strong": case "b": {
      const t = inner().trim();
      return t ? `**${t}**` : "";
    }
    case "em": case "i": {
      const t = inner().trim();
      return t ? `_${t}_` : "";
    }
    case "u": return `<u>${inner()}</u>`;
    case "s": case "strike": case "del": {
      const t = inner().trim();
      return t ? `~~${t}~~` : "";
    }
    case "a": {
      const href = el.getAttribute("href") || "";
      const t = inner().trim() || href;
      return href ? `[${t}](${href})` : t;
    }
    case "ul":
      return "\n" + Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === "li")
        .map((li) => `- ${serializeChildren(li).trim()}`)
        .join("\n") + "\n\n";
    case "ol":
      return "\n" + Array.from(el.children)
        .filter((c) => c.tagName.toLowerCase() === "li")
        .map((li, i) => `${i + 1}. ${serializeChildren(li).trim()}`)
        .join("\n") + "\n\n";
    case "li": return `- ${inner().trim()}\n`;
    case "blockquote": return `\n> ${inner().trim().replace(/\n/g, "\n> ")}\n\n`;
    case "table": return tableToMarkdown(el as HTMLTableElement);
    case "img": {
      const src = el.getAttribute("src") || "";
      return src ? `![](${src})` : "";
    }
    case "code": return `\`${inner()}\``;
    case "pre": return `\n\`\`\`\n${el.textContent ?? ""}\n\`\`\`\n\n`;
    case "span": case "font": return inlineStyleWrap(el, inner());
    case "style": case "script": case "meta": case "title": return "";
    default: return inner();
  }
}

/** Convert pasted HTML (Word / Google Docs / web) into clean markdown. */
export function htmlToMarkdown(html: string): string {
  if (typeof window === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return serializeChildren(doc.body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ /g, " ")
    .trim();
}
