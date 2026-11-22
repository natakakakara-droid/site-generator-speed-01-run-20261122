// Faster drop-in for makefun-site 1.0.0 (make.fun bounty site-generator-speed-01-run-20261122).
// A tight single-pass reimplementation of the vendor reference: byte-for-byte identical
// output, precompiled flat template ops, hand-rolled indexOf/charCode scanners (no regexes
// in hot loops), array-built output joined once. Dependency-free ES module.
//
// The reference is the vendor code (kit/baselines/makefun-site/vendor/makefun-site/);
// where its README and code differ, the code rules, and this file follows the code.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Code-unit order (never the locale's). */
const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

/** `s[a..b)` escaped, appended to `out` without building an intermediate string. */
function escapeInto(s, a, b, out) {
  let p = a;
  for (let j = a; j < b; j++) {
    const c = s.charCodeAt(j);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      if (j > p) out.push(s.slice(p, j));
      out.push(rep);
      p = j + 1;
    }
  }
  if (b > p) out.push(s.slice(p, b));
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Whether `line` is blank (spaces and tabs only). */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** `line` with spaces and tabs dropped at either end. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

// ---------------------------------------------------------------- text (lib/text.js)

function slugify(text, cx) {
  const hit = cx.slugCache.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  out = out.slice(0, 64).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  cx.slugCache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(date, cx) {
  let v = cx.dateCache.get(date);
  if (v === undefined) {
    v = `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
    cx.dateCache.set(date, v);
  }
  return v;
}

// ---------------------------------------------------------------- front matter (lib/frontmatter.js)

const KNOWN_KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);

/** A string value: "..." with \" and \\ its only escapes, or bare. */
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function isDigit(c) {
  return c >= 48 && c <= 57;
}

function dateValue(raw) {
  const err = { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
  if (raw.length !== 10) return err;
  for (let i = 0; i < 10; i++) {
    if (i === 4 || i === 7) {
      if (raw.charCodeAt(i) !== 45) return err;
    } else if (!isDigit(raw.charCodeAt(i))) return err;
  }
  const y = (raw.charCodeAt(0) - 48) * 1000 + (raw.charCodeAt(1) - 48) * 100 + (raw.charCodeAt(2) - 48) * 10 + (raw.charCodeAt(3) - 48);
  const mo = (raw.charCodeAt(5) - 48) * 10 + (raw.charCodeAt(6) - 48);
  const d = (raw.charCodeAt(8) - 48) * 10 + (raw.charCodeAt(9) - 48);
  if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return err;
  return { value: raw };
}

function tagsValue(raw) {
  if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
  const inner = raw.slice(1, -1);
  if (inner.trim() === '') return { value: [] };
  const parts = inner.split(',');
  const tags = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i].trim();
    if (t === '' || t.indexOf('"') !== -1 || t.indexOf('[') !== -1 || t.indexOf(']') !== -1) {
      return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
    }
    tags[i] = t;
  }
  return { value: tags };
}

function isName(raw) {
  if (raw.length === 0) return false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return false;
  }
  return true;
}

function isSlugRaw(raw) {
  const n = raw.length;
  if (n === 0 || n > 64) return false;
  let i = 0;
  while (i < n) {
    const c0 = raw.charCodeAt(i);
    if (!((c0 >= 97 && c0 <= 122) || (c0 >= 48 && c0 <= 57))) return false;
    i++;
    while (i < n) {
      const c = raw.charCodeAt(i);
      if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) i++;
      else break;
    }
    if (i < n) {
      if (raw.charCodeAt(i) !== 45) return false;
      i++;
      if (i >= n) return false;
    }
  }
  return true;
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date':
      return dateValue(raw);
    case 'tags':
      return tagsValue(raw);
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return isName(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return isSlugRaw(raw) ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  if (text !== '---' && text.slice(0, 4) !== '---\n') return { error: 'no front matter' };
  // The closing line is the next line that is exactly '---': find '\n---' whose
  // '---' is followed by '\n' or the end of the text.
  let p = -1;
  let from = 3;
  for (;;) {
    const q = text.indexOf('\n---', from);
    if (q === -1) return { error: 'the front matter is not closed' };
    if (q + 4 === text.length || text.charCodeAt(q + 4) === 10) {
      p = q;
      break;
    }
    from = q + 1;
  }
  // The lines between the opening and closing '---' are text[4..p].
  const mid = text.slice(4, p);
  const fmLines = mid === '' ? [] : mid.split('\n');
  const data = {};
  for (let k = 0; k < fmLines.length; k++) {
    const line = fmLines[k];
    if (isBlank(line) || line.charCodeAt(0) === 35) continue;
    let j = 0;
    while (j < line.length) {
      const c = line.charCodeAt(j);
      if ((c >= 97 && c <= 122) || c === 95) j++;
      else break;
    }
    if (j === 0 || line.charCodeAt(j) !== 58) return { error: `line ${k + 2} is not "key: value"` };
    const key = line.slice(0, j);
    let raw;
    if (j + 1 === line.length) raw = '';
    else if (line.charCodeAt(j + 1) === 32) raw = line.slice(j + 2);
    else return { error: `line ${k + 2} is not "key: value"` };
    let e = raw.length;
    while (e > 0 && (raw.charCodeAt(e - 1) === 32 || raw.charCodeAt(e - 1) === 9)) e--;
    if (e !== raw.length) raw = raw.slice(0, e);
    if (!KNOWN_KEYS.has(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  // The body is everything after the closing line's '\n' ('' when it is the last line).
  return { data, body: p + 4 === text.length ? '' : text.slice(p + 5) };
}

// ---------------------------------------------------------------- markdown (lib/markdown.js)

/** A fence-open line's language, or null. */
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let j = 3;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) j++;
    else break;
  }
  const lang = line.slice(3, j);
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return null;
    j++;
  }
  return lang;
}

/** Whether `line` closes a fence. */
function fenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A heading line's level and text, or null. */
function headingOf(line) {
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === 35) n++;
  if (n === 0 || n > 6 || n >= line.length) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  let e = line.length;
  while (e > n && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  let s = n;
  while (s < e && (line.charCodeAt(s) === 32 || line.charCodeAt(s) === 9)) s++;
  if (s >= e) return null;
  return { depth: n, text: line.slice(s, e) };
}

/** Whether `line` is a thematic break. */
function isHR(line) {
  const c0 = line.charCodeAt(0);
  if (c0 === 45) {
    if (line.charCodeAt(1) !== 45 || line.charCodeAt(2) !== 45) return false;
  } else if (c0 === 42) {
    if (line.charCodeAt(1) !== 42 || line.charCodeAt(2) !== 42) return false;
  } else return false;
  for (let j = 3; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A bullet item line's text, or null. */
function bulletOf(line) {
  const c0 = line.charCodeAt(0);
  if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return line.slice(2);
  return null;
}

/** An ordered item line's number and text, or null. */
function orderedOf(line) {
  let j = 0;
  while (j < line.length && j < 9 && isDigit(line.charCodeAt(j))) j++;
  if (j === 0) return null;
  if (line.charCodeAt(j) !== 46 || line.charCodeAt(j + 1) !== 32) return null;
  return { num: Number(line.slice(0, j)), text: line.slice(j + 2) };
}

const CONTINUED = /^ {2,}\S/;

/** Whether `line` continues a paragraph (not blank, fence, heading or thematic break). */
function continuesParagraph(line) {
  if (line === '') return false;
  const c0 = line.charCodeAt(0);
  if (c0 === 32 || c0 === 9) return !isBlank(line);
  if (c0 === 96) return fenceOpen(line) === null;
  if (c0 === 35) return headingOf(line) === null;
  if (c0 === 45 || c0 === 42) return !isHR(line);
  return true;
}

/** A list block starting at `lines[i]` appended to `parts`; returns the next line index. */
function listBlock(lines, i, isOrdered, start, env, parts) {
  const items = [];
  while (i < lines.length) {
    const l = lines[i];
    let text;
    if (isOrdered) {
      const m = orderedOf(l);
      if (m === null) {
        if (CONTINUED.test(l)) {
          items[items.length - 1] += `\n${trimLine(l)}`;
          i++;
          continue;
        }
        break;
      }
      text = m.text;
    } else {
      const m = bulletOf(l);
      if (m === null) {
        if (CONTINUED.test(l)) {
          items[items.length - 1] += `\n${trimLine(l)}`;
          i++;
          continue;
        }
        break;
      }
      text = m;
    }
    items.push(trimLine(text));
    i++;
  }
  const tag = isOrdered ? 'ol' : 'ul';
  parts.push(isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`, '\n');
  for (let k = 0; k < items.length; k++) {
    parts.push('<li>');
    inlineInto(items[k], 0, items[k].length, env, parts);
    parts.push('</li>\n');
  }
  parts.push(`</${tag}>\n`);
  return i;
}

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

const WS_RE = /\s/;

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

const CONSTRUCT_RE = /[\\`*[]/g;
const ESCAPE_RE = /[&<>"']/g;
/** The HTML escape table. */
const ESCAPES2 = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Whether `s[a..b)` holds an inline-construct character. */
function hasConstruct(s, a, b) {
  CONSTRUCT_RE.lastIndex = a;
  const m = CONSTRUCT_RE.exec(s);
  return m !== null && m.index < b;
}

/**
 * `s[a..b)` rendered inline, appended to `out`; `env.link(target)` is a link's href.
 * A span with no construct character is escaped in one C-level replace; otherwise one
 * pass slices plain runs out whole and replaces & < > " ' as met.
 */
function inlineInto(s, a, b, env, out) {
  if (a < b && !hasConstruct(s, a, b)) {
    out.push(s.slice(a, b).replace(ESCAPE_RE, (c) => ESCAPES2[c]));
    return;
  }
  let i = a;
  let chunk = a;
  while (i < b) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < b && ESCAPABLE.has(s[i + 1])) {
        if (i > chunk) out.push(s.slice(chunk, i));
        const nx = s[i + 1];
        out.push(nx === '>' ? '&gt;' : nx);
        i += 2;
        chunk = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j !== -1 && j > i + 1 && j < b) {
        if (i > chunk) out.push(s.slice(chunk, i));
        out.push('<code>');
        escapeInto(s, i + 1, j, out);
        out.push('</code>');
        i = j + 1;
        chunk = i;
      } else i++;
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j !== -1 && j > i + 2 && j < b) {
          if (i > chunk) out.push(s.slice(chunk, i));
          out.push('<strong>');
          inlineInto(s, i + 2, j, env, out);
          out.push('</strong>');
          i = j + 2;
          chunk = i;
        } else i += 2;
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j !== -1 && j > i + 1 && j < b) {
        if (i > chunk) out.push(s.slice(chunk, i));
        out.push('<em>');
        inlineInto(s, i + 1, j, env, out);
        out.push('</em>');
        i = j + 1;
        chunk = i;
      } else i++;
      continue;
    }
    if (c === 91) {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && k < b && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 || m >= b ? '' : s.slice(k + 2, m);
      if (target !== '' && !WS_RE.test(target)) {
        if (i > chunk) out.push(s.slice(chunk, i));
        out.push('<a href="');
        const href = env.link(target);
        escapeInto(href, 0, href.length, out);
        out.push('">');
        inlineInto(s, i + 1, k, env, out);
        out.push('</a>');
        i = m + 1;
        chunk = i;
        continue;
      }
      i++;
      continue;
    }
    if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) {
      if (i > chunk) out.push(s.slice(chunk, i));
      out.push(c === 38 ? '&amp;' : c === 60 ? '&lt;' : c === 62 ? '&gt;' : c === 34 ? '&quot;' : '&#39;');
      i++;
      chunk = i;
      continue;
    }
    i++;
  }
  if (b > chunk) out.push(s.slice(chunk, b));
}

function inlineStr(s, env) {
  const out = [];
  inlineInto(s, 0, s.length, env, out);
  return out.join('');
}

/** `src` rendered: its HTML, table of contents and excerpt. */
function renderMarkdown(src, env, cx) {
  const lines = src.split('\n');
  const n = lines.length;
  const parts = [];
  const toc = [];
  let excerpt = '';
  let hasExcerpt = false;
  const ids = new Set();
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (line === '') {
      i++;
      continue;
    }
    const c0 = line.charCodeAt(0);
    if (c0 === 32 || c0 === 9) {
      if (isBlank(line)) {
        i++;
        continue;
      }
      // A leading-space line that is not blank is a paragraph line.
    } else if (c0 === 96) {
      const fence = fenceOpen(line);
      if (fence !== null) {
        const body = [];
        i++;
        while (i < n && !fenceClose(lines[i])) body.push(lines[i++]);
        i++;
        parts.push('<pre><code');
        if (fence !== '') {
          parts.push(' class="language-');
          escapeInto(fence, 0, fence.length, parts);
          parts.push('"');
        }
        parts.push('>');
        for (let k = 0; k < body.length; k++) {
          escapeInto(body[k], 0, body[k].length, parts);
          parts.push('\n');
        }
        parts.push('</code></pre>\n');
        continue;
      }
    } else if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        const id = uniqueSlug(slugify(heading.text, cx), ids);
        const html = inlineStr(heading.text, env);
        parts.push(`<h${heading.depth} id="${id}">`, html, `</h${heading.depth}>\n`);
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (isHR(line)) {
        parts.push('<hr>\n');
        i++;
        continue;
      }
      const bullet = bulletOf(line);
      if (bullet !== null) {
        i = listBlock(lines, i, false, 1, env, parts);
        continue;
      }
    } else if (c0 === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(trimLine(l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1)));
      }
      const kept = body.filter((l) => l !== '');
      if (kept.length === 0) parts.push('<blockquote>\n</blockquote>\n');
      else {
        const joined = kept.join('\n');
        parts.push('<blockquote>\n<p>');
        inlineInto(joined, 0, joined.length, env, parts);
        parts.push('</p>\n</blockquote>\n');
      }
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      const ordered = orderedOf(line);
      if (ordered !== null) {
        i = listBlock(lines, i, true, ordered.num, env, parts);
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && continuesParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const text = body.join('\n');
    if (!hasExcerpt) {
      excerpt = inlineStr(text, env);
      hasExcerpt = true;
      parts.push('<p>', excerpt, '</p>\n');
    } else {
      parts.push('<p>');
      inlineInto(text, 0, text.length, env, parts);
      parts.push('</p>\n');
    }
  }
  return { html: parts.join(''), toc, excerpt };
}

// ---------------------------------------------------------------- templates (lib/template.js)

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** Whether `src[a..b)` holds only spaces and tabs. */
function isSpaces(src, a, b) {
  for (let j = a; j < b; j++) {
    const c = src.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

// Flat ops: [0, text] [1, path] var [2, path] raw [3, name, path, endIdx] for
//            [4, path, not, elseIdx, endIdx] if [5, endIdx] else [6, forIdx] endfor [7, name] include
//
// Like the reference, compiling is two phases: tokenize first (a bad {{ }} path or an
// unclosed delimiter anywhere beats any {% %} tag error), then parse the tokens into
// flat ops (a bad tag or an unclosed block is reported in token order).
function tokenizeTemplate(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === n - 1) {
      text += src.slice(i);
      break;
    }
    const next = src.charCodeAt(open + 1);
    if (next !== 123 && next !== 37) {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === 123) {
      const raw = src.charCodeAt(open + 2) === 123;
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? n : nl;
    const standalone = isSpaces(src, lineStart, open) && isSpaces(src, end, lineEnd);
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? n : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function compileTemplate(name, src) {
  const ops = [];
  const stack = [];
  for (const tok of tokenizeTemplate(name, src)) {
    if (tok.t === 'text') ops.push([0, tok.text]);
    else if (tok.t === 'var' || tok.t === 'raw') ops.push([tok.t === 'raw' ? 2 : 1, tok.path]);
    else {
      const tag = tok.tag;
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        ops.push([3, m[1], pathOf(name, m[2]), -1]);
        stack.push({ kind: 'for', idx: ops.length - 1 });
      } else if ((m = IF_RE.exec(tag)) !== null) {
        ops.push([4, pathOf(name, m[2]), m[1] !== undefined, -1, -1]);
        stack.push({ kind: 'if', idx: ops.length - 1 });
      } else if (tag === 'else') {
        const top = stack[stack.length - 1];
        if (top === undefined || top.kind !== 'if' || ops[top.idx][3] !== -1) {
          throw new TemplateError(`template "${name}": an else outside an if`);
        }
        ops[top.idx][3] = ops.length;
        ops.push([5, -1]);
        top.elseIdx = ops.length - 1;
      } else if (tag === 'endfor' || tag === 'endif') {
        const top = stack[stack.length - 1];
        const want = tag === 'endfor' ? 'for' : 'if';
        if (top === undefined || top.kind !== want) {
          throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        }
        stack.pop();
        if (want === 'for') {
          ops[top.idx][3] = ops.length;
          ops.push([6, top.idx]);
        } else {
          ops[top.idx][4] = ops.length;
          if (top.elseIdx !== undefined) ops[top.elseIdx][1] = ops.length;
        }
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) {
        ops.push([7, m[1]]);
      } else {
        throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
      }
    }
  }
  if (stack.length > 0) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return ops;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it. */
function lookup(scopes, path) {
  const first = path[0];
  for (let s = scopes.length - 1; s >= 0; s--) {
    const vars = scopes[s];
    if (Object.hasOwn(vars, first)) {
      let v = vars[first];
      for (let k = 1; k < path.length; k++) {
        if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
        v = v[path[k]];
      }
      return v;
    }
  }
  return undefined;
}

/** A value as text. */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** `ops` rendered in `scopes` (innermost last), appended to `out`. */
function renderOps(ops, templates, scopes, out, depth) {
  let pc = 0;
  const n = ops.length;
  const frames = [];
  while (pc < n) {
    const op = ops[pc];
    switch (op[0]) {
      case 0:
        out.push(op[1]);
        pc++;
        break;
      case 1: {
        const v = textOf(lookup(scopes, op[1]));
        escapeInto(v, 0, v.length, out);
        pc++;
        break;
      }
      case 2:
        out.push(textOf(lookup(scopes, op[1])));
        pc++;
        break;
      case 3: {
        const xs = lookup(scopes, op[2]);
        if (!Array.isArray(xs) || xs.length === 0) {
          pc = op[3] + 1;
          break;
        }
        const vars = {};
        vars[op[1]] = xs[0];
        vars.loop = { index: 1, first: true, last: xs.length === 1, length: xs.length };
        scopes.push(vars);
        frames.push({ forIdx: pc, arr: xs, idx: 0, vars });
        pc++;
        break;
      }
      case 4: {
        const v = truthy(lookup(scopes, op[1]));
        pc = v !== op[2] ? pc + 1 : op[3] !== -1 ? op[3] + 1 : op[4];
        break;
      }
      case 5:
        pc = op[1];
        break;
      case 6: {
        const fr = frames[frames.length - 1];
        fr.idx++;
        if (fr.idx < fr.arr.length) {
          const fname = ops[fr.forIdx][1];
          if (fname !== 'loop') fr.vars[fname] = fr.arr[fr.idx];
          const lp = fr.vars.loop;
          lp.index = fr.idx + 1;
          lp.first = fr.idx === 0;
          lp.last = fr.idx === fr.arr.length - 1;
          pc = fr.forIdx + 1;
        } else {
          frames.pop();
          scopes.pop();
          pc++;
        }
        break;
      }
      case 7: {
        const t = templates.get(op[1]);
        if (t !== undefined && depth < 8) renderOps(t, templates, scopes, out, depth + 1);
        pc++;
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- the build (index.js)

/** `rel` from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Whitespace in the sense of \s, as a table over UTF-16 code units. */
const WS_TABLE = new Uint8Array(65536);
for (const c of [9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279]) WS_TABLE[c] = 1;
for (let c = 8192; c <= 8202; c++) WS_TABLE[c] = 1;

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (WS_TABLE[text.charCodeAt(i)]) inWord = false;
    else if (!inWord) {
      count++;
      inWord = true;
    }
  }
  return count;
}

/** One site's output tree: path -> text. */
export function run(input) {
  const cx = { slugCache: new Map(), dateCache: new Map() };
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');
  const broken = new Set();

  // 1. The sources, in code-unit order of their paths.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    } else statics.push({ path: f.path, content: f.content });
  }

  // 2. Each source's front matter.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = s.path.startsWith('tags/') ? 'tags' : s.path.startsWith('page/') ? 'page' : undefined;
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // 3. Each page's output directory and url.
  const bySource = new Map();
  const taken = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? ['posts', 'tags', 'page'] : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, cx), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Each body's Markdown, its links resolved.
  const staticPaths = new Set(statics.map((f) => f.path));
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link(target) {
        if (SCHEME_RE.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env, cx);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.readingMinutes = Math.max(1, Math.ceil(wordsOf(s.body) / 200));
  }

  // 5. The posts, newest first and then by slug.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // 6. The tags.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name, cx);
      if (!seen.has(slug)) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name, cx);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (!s.post) {
      s.tagRefs = ownTags(s).map((name) => {
        const slug = slugify(name, cx);
        return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
      });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) =>
    s === null
      ? null
      : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date, cx) };

  const cards = new Map();
  for (const p of posts) {
    cards.set(p, {
      title: p.data.title,
      url: p.url,
      date: p.data.date ?? '',
      date_long: p.data.date === undefined ? '' : longDate(p.data.date, cx),
      summary: p.data.summary ?? '',
      excerpt: p.excerpt,
      reading_minutes: p.readingMinutes,
      tags: p.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    });
  }

  const pageOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date, cx),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: s.readingMinutes,
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });

  // 7. Every page through its layout, the index pages and the tag pages through theirs.
  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const render = (name, vars) => {
    const ops = templates.get(name);
    if (ops === undefined) return null;
    const out = [];
    renderOps(ops, templates, [{ site, tags: allTags, recent, ...vars }], out, 0);
    return out.join('');
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', {
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) },
    });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. The report.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
