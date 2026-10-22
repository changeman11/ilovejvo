// A small, safe text formatter for the FAQ and rulebook (admins type these in a text box).
// Everything is escaped first, so nothing typed can become a script or a link to somewhere odd.
//
//   # Heading            ## Smaller heading
//   - bullet             1. numbered
//   **bold**             *italic*            [link text](https://…)
//   blank line = new paragraph

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Bold, italic and links inside one line (already escaped).
export function inline(text) {
  return escHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_, label, href) => {
      const external = href.startsWith('http');
      return `<a href="${href}"${external ? ' target="_blank" rel="noopener"' : ' data-link'}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

// Text -> HTML. headingLevel: the HTML level for "#" (so a page with an h1 can start at h2).
export function markdown(text, { headingLevel = 2 } = {}) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.+)/);
    const bullet = line.match(/^\s*[-*•]\s+(.+)/);
    const num = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) {
      flushPara(); flushList();
      const level = Math.min(6, headingLevel + h[1].length - 1);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (bullet || num) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (list?.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet ?? num)[1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}

// FAQ text: each "## Question" (or "Q: …") starts a question; the lines under it are the answer.
// "# Heading" lines group questions. Returns [{ heading, items: [{ q, a }] }].
export function parseFaq(text) {
  const groups = [{ heading: null, items: [] }];
  let current = null;
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const heading = raw.match(/^#\s+(.+)/);
    const q = raw.match(/^(?:##\s+|Q:\s*)(.+)/i);
    if (heading) {
      groups.push({ heading: heading[1].trim(), items: [] });
      current = null;
    } else if (q) {
      current = { q: q[1].trim(), a: '' };
      groups.at(-1).items.push(current);
    } else if (current) {
      current.a += `${raw.replace(/^A:\s*/i, '')}\n`;
    }
  }
  return groups.filter((g) => g.items.length);
}
