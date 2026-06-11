// Minimal, safe Markdown renderer for the detail panel. Everything is escaped
// before any HTML is produced — raw HTML in the source never passes through.
// Covers the structure that matters for reading agent docs: headings, lists
// (nested, with task checkboxes), fenced code, inline code, tables, quotes,
// links, emphasis, and rules.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

/* inline: protect code spans, then apply span rules to the rest */
function inlineMD(text) {
  let out = '';
  let last = 0;
  const re = /(`+)([\s\S]+?)\1/g;
  let m;
  while ((m = re.exec(text))) {
    out += spans(text.slice(last, m.index));
    out += `<code>${esc(m[2].trim())}</code>`;
    last = m.index + m[0].length;
  }
  return out + spans(text.slice(last));
}

function spans(raw) {
  let s = esc(raw);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return s;
}

function renderList(items) {
  if (!items.length) return '';
  const base = items[0].indent;
  const ordered = items[0].ordered;
  let html = ordered ? '<ol>' : '<ul>';
  let j = 0;
  while (j < items.length) {
    const it = items[j];
    j++;
    const kids = [];
    while (j < items.length && items[j].indent > base) { kids.push(items[j]); j++; }
    let text = it.text;
    let check = '';
    const task = text.match(/^\[( |x|X)\]\s+(.*)$/);
    if (task) {
      check = `<span class="md-check${task[1] === ' ' ? '' : ' on'}" aria-hidden="true"></span>`;
      text = task[2];
    }
    html += `<li>${check}${inlineMD(text)}${kids.length ? renderList(kids) : ''}</li>`;
  }
  return html + (ordered ? '</ol>' : '</ul>');
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flushP = () => {
    if (para.length) { out.push(`<p>${inlineMD(para.join('\n'))}</p>`); para = []; }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    /* fenced code */
    const fence = line.match(/^\s*(`{3,})\s*(\S*)\s*$/);
    if (fence) {
      flushP();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) { buf.push(lines[i]); i++; }
      i++; // closing fence (or EOF)
      out.push(`<pre class="md-code"${fence[2] ? ` data-lang="${esc(fence[2])}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) { flushP(); i++; continue; }

    /* heading */
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushP();
      const lv = h[1].length;
      out.push(`<h${lv}>${inlineMD(h[2].replace(/\s#+\s*$/, ''))}</h${lv}>`);
      i++;
      continue;
    }

    /* horizontal rule */
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushP(); out.push('<hr>'); i++; continue; }

    /* blockquote */
    if (/^\s*>/.test(line)) {
      flushP();
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`);
      continue;
    }

    /* table (header row + |---| separator) */
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      flushP();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      out.push(
        '<table><thead><tr>' + head.map((c) => `<th>${inlineMD(c)}</th>`).join('') + '</tr></thead><tbody>'
        + rows.slice(2).map((r) => {
          const cs = cells(r);
          return '<tr>' + head.map((_, ci) => `<td>${inlineMD(cs[ci] ?? '')}</td>`).join('') + '</tr>';
        }).join('')
        + '</tbody></table>');
      continue;
    }

    /* lists (nested by indentation; - * + or 1. 1)) */
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
      flushP();
      const items = [];
      while (i < lines.length) {
        const m2 = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m2) {
          items.push({ indent: m2[1].replace(/\t/g, '  ').length, ordered: /\d/.test(m2[2]), text: m2[3] });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += '\n' + lines[i].trim(); // hanging continuation
          i++;
        } else break;
      }
      out.push(renderList(items));
      continue;
    }

    para.push(line);
    i++;
  }
  flushP();
  return out.join('\n');
}
