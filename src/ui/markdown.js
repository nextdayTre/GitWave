/**
 * markdown.js — zero-dependency, XSS-safe Markdown-to-DOM renderer for GitWave.
 *
 * Strictly obeys Rule 5: NEVER uses `innerHTML`. Every heading, paragraph,
 * table, code block, list item, blockquote and inline span is constructed via
 * DOM APIs and `textContent`.
 */

import { el } from "./dom.js";

/** Append inline-formatted text (`code`, **bold**, *italic*, ![img](url), [label](url)) safely via textContent. */
function appendInline(parent, text) {
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    const tok = match[0];
    if (tok.startsWith("`")) {
      parent.appendChild(el("code", "md-inline-code", tok.slice(1, -1)));
    } else if (tok.startsWith("**")) {
      const strong = document.createElement("strong");
      appendInline(strong, tok.slice(2, -2));
      parent.appendChild(strong);
    } else if (tok.startsWith("*")) {
      const em = document.createElement("em");
      appendInline(em, tok.slice(1, -1));
      parent.appendChild(em);
    } else if (tok.startsWith("![")) {
      const alt = match[2] || match[3] || "image";
      const src = match[3] || "";
      const pill = el("span", "md-inline-code", `[image: ${alt}]`);
      pill.title = src;
      parent.appendChild(pill);
    } else if (tok.startsWith("[")) {
      const label = match[4] || tok;
      const href = match[5] || "";
      const span = el("span", "md-link", label);
      span.title = href;
      parent.appendChild(span);
    }
    last = re.lastIndex;
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

function isTableSeparator(line) {
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Render markdown string into a clean, styled `.md-doc` DOM container. */
export function renderMarkdownDom(markdown) {
  const doc = el("article", "md-doc");
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    /* Fenced code block */
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const wrap = el("div", "md-code-block");
      if (lang) wrap.appendChild(el("div", "md-code-lang", lang));
      const pre = el("pre", "md-pre");
      pre.appendChild(el("code", "", codeLines.join("\n")));
      wrap.appendChild(pre);
      doc.appendChild(wrap);
      continue;
    }

    /* Horizontal rule */
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      doc.appendChild(document.createElement("hr"));
      i += 1;
      continue;
    }

    /* Headings # .. #### */
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const lvl = heading[1].length;
      const h = el(`h${lvl}`, `md-h${lvl}`);
      appendInline(h, heading[2].replace(/\s+#+$/, ""));
      doc.appendChild(h);
      i += 1;
      continue;
    }

    /* Blockquote */
    if (trimmed.startsWith(">")) {
      const bq = el("blockquote", "md-quote");
      const qLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        qLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      const p = el("p", "");
      appendInline(p, qLines.join(" "));
      bq.appendChild(p);
      doc.appendChild(bq);
      continue;
    }

    /* Markdown table */
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const tableWrap = el("div", "md-table-wrap");
      const table = el("table", "md-table");
      const thead = document.createElement("thead");
      const hRow = document.createElement("tr");
      for (const cell of splitTableRow(lines[i])) {
        const th = document.createElement("th");
        appendInline(th, cell);
        hRow.appendChild(th);
      }
      thead.appendChild(hRow);
      table.appendChild(thead);
      i += 2;

      const tbody = document.createElement("tbody");
      while (i < lines.length && lines[i].trim().includes("|") && !lines[i].trim().startsWith("#")) {
        const tr = document.createElement("tr");
        for (const cell of splitTableRow(lines[i])) {
          const td = document.createElement("td");
          appendInline(td, cell);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
        i += 1;
      }
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      doc.appendChild(tableWrap);
      continue;
    }

    /* Unordered / ordered lists */
    if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const list = el(ordered ? "ol" : "ul", "md-list");
      while (i < lines.length) {
        const lt = lines[i].trim();
        const m = ordered ? lt.match(/^\d+\.\s+(.+)$/) : lt.match(/^[-*+]\s+(.+)$/);
        if (!m) break;
        const li = document.createElement("li");
        appendInline(li, m[1]);
        list.appendChild(li);
        i += 1;
      }
      doc.appendChild(list);
      continue;
    }

    /* Regular paragraph */
    const pLines = [];
    while (i < lines.length) {
      const lt = lines[i].trim();
      if (
        !lt ||
        lt.startsWith("#") ||
        lt.startsWith("```") ||
        lt.startsWith(">") ||
        /^[-*+]\s+/.test(lt) ||
        /^\d+\.\s+/.test(lt) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(lt) ||
        (lt.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      pLines.push(lt);
      i += 1;
    }
    const p = el("p", "md-p");
    appendInline(p, pLines.join(" "));
    doc.appendChild(p);
  }

  return doc;
}
