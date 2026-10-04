// Shared helpers: DOM builder, list codec, catalog data access, local storage.

export const DRN = "drn:src:marvel:unison::prod:";
export const CG = "https://www.continuityguide.net";

// ---------- DOM ----------

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (s, r = document) => r.querySelector(s);

let toastTimer;
export function toast(msg) {
  let t = $("#toast");
  if (!t) document.body.append((t = h("div", { id: "toast", role: "status", "aria-live": "polite" })));
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}

export async function copyText(text, msg = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(msg);
}

// ---------- links ----------

export function appLink(it) {
  return `https://marvel.smart.link/fiir7ec77?type=issue&drn=${DRN}${it.drn}&sourceId=${it.src ?? ""}`;
}

export function coverUrl(path, w = 160) {
  return path ? `https://i.marvelfe.com/m/${path}?w=${w}` : "";
}

export function seriesName(t, y) {
  return y ? `${t} (${y})` : t;
}

export function issueName(it) {
  return `${seriesName(it.t, it.y)}${it.num != null ? " #" + it.num : ""}`;
}

// ---------- list codec ----------
// List: {t, d, s:[{n, d, i:[item]}]}
// item (compact): digitalId | [digitalId, flags, note, webUrl?] | "free text" | ["free text", flags, note]
// webUrl: optional marvel.com page that replaces the app link (for issues the app can't open)
// flags bit 1 = optional
// Link: "2" + base64url(deflate-raw(JSON with delta-coded ids)); "1" = same without deltas (older links);
// "0" = base64url(JSON) when CompressionStream is missing.

const b64u = {
  enc(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function compact(list) {
  const item = (it) => {
    const key = it.id ?? it.text;
    const flags = it.opt ? 1 : 0;
    if (it.web) return [key, flags, it.note || "", it.web];
    if (!flags && !it.note) return key;
    return it.note ? [key, flags, it.note] : [key, flags];
  };
  const o = { t: list.title || "" };
  if (list.desc) o.d = list.desc;
  o.s = list.sections.map((s) => {
    const so = { n: s.name || "" };
    if (s.desc) so.d = s.desc;
    so.i = s.items.map(item);
    return so;
  });
  return o;
}

export function expand(o) {
  const item = (x) => {
    const [key, flags = 0, note = "", web] = Array.isArray(x) ? x : [x];
    const it = typeof key === "number" ? { id: key, opt: !!(flags & 1), note } : { text: String(key), opt: !!(flags & 1), note };
    if (safeWeb(web)) it.web = web;
    return it;
  };
  return {
    title: o.t || "",
    desc: o.d || "",
    sections: (o.s || []).map((s) => ({ name: s.n || "", desc: s.d || "", items: (s.i || []).map(item) })),
  };
}

// Digital ids of neighbouring issues are close together, so storing each id as the
// difference from the previous one compresses ~13% better.
function deltas(o, dir) {
  let prev = 0;
  for (const s of o.s || []) {
    s.i = (s.i || []).map((x) => {
      const arr = Array.isArray(x), k = arr ? x[0] : x;
      if (typeof k !== "number") return x;
      const v = dir > 0 ? k - prev : k + prev;
      prev = dir > 0 ? k : v;
      return arr ? [v, ...x.slice(1)] : v;
    });
  }
  return o;
}

// Web links in shared lists may only point at marvel.com, so a list can't send people elsewhere
export function safeWeb(url) {
  return typeof url === "string" && /^https:\/\/www\.marvel\.com\/[^\s"<>]*$/.test(url);
}

export async function encodeList(list) {
  if (typeof CompressionStream === "function") {
    const json = new TextEncoder().encode(JSON.stringify(deltas(compact(list), 1)));
    return "2" + b64u.enc(await pipe(json, new CompressionStream("deflate-raw")));
  }
  return "0" + b64u.enc(new TextEncoder().encode(JSON.stringify(compact(list))));
}

export async function decodeList(code) {
  const v = code[0], body = b64u.dec(code.slice(1));
  const bytes = v === "0" ? body : await pipe(body, new DecompressionStream("deflate-raw"));
  const o = JSON.parse(new TextDecoder().decode(bytes));
  return expand(v === "2" ? deltas(o, -1) : o);
}

export function shareUrl(code) {
  return `${location.origin}${location.pathname}#l=${code}`;
}

// Native share sheet on phones/tablets, clipboard elsewhere.
export async function shareLink(url, title) {
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: title || "Reading list", url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  copyText(url, "Link copied");
}

// 1 Details > 2 Add issues > 3 Preview & share
export function stepper(active, draftId) {
  const steps = [["i", "Details"], ["d", "Add issues"], ["p", h("span", {}, h("span", { class: "wide" }, "Preview & "), "share")]];
  return h("nav", { class: "steps", "aria-label": "Steps" },
    h("ol", {}, steps.map(([k, label], i) => h("li", { class: k === active ? "on" : "" },
      h("a", { href: `#${k}=${draftId}`, "aria-current": k === active ? "step" : null },
        h("span", { class: "num" }, i + 1), h("span", { class: "lbl" }, label))))));
}

// ---------- catalog data ----------

const cache = new Map();
function getJSON(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    }).catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}

// series index rows: {id, t, y, n, r:[first,last], d:[y0,y1], c, g}
export const loadIndex = () => getJSON("data/series.json");

// series: {id, t, y, cg:[pages], i:[[digitalId, num, date, drn, src, cover]]}
export async function loadSeries(id) {
  const s = await getJSON(`data/s/${id}.json`);
  return { ...s, issues: s.i.map(([id, num, date, drn, src, cover]) => ({ id, num, date, drn, src, cover, t: s.t, y: s.y, sid: s.id })) };
}

// digital id -> issue
export async function resolveIds(ids) {
  const shards = [...new Set(ids.map((id) => Math.floor(id / 1000)))];
  const maps = await Promise.all(shards.map((k) => getJSON(`data/d/${k}.json`).catch(() => ({}))));
  const out = new Map();
  for (const m of maps) {
    for (const id of ids) {
      const r = m[id];
      if (r) {
        const [sid, t, y, num, date, drn, src, cover] = r;
        out.set(id, { id, sid, t, y, num, date, drn, src, cover });
      }
    }
  }
  return out;
}

// ---------- search ----------

export const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

// Spelling-insensitive key: "X-Men", "xmen", "X Men" -> "xmen"; "The Amazing Spider-Man" -> "amazingspiderman"
export const compactKey = (s) => norm(s).replace(/^the /, "").replace(/ /g, "");

// Edit distance (adjacent swaps count as one edit, so "maruaders" is 1 from "marauders"),
// with an early exit once it exceeds max (returns max + 1)
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

// typo allowance grows with length: short titles must be exact
export const typoBudget = (key) => (key.length < 5 ? 0 : key.length < 10 ? 1 : 2);

let prepared;
export async function searchSeries(q, limit = 40) {
  const idx = await loadIndex();
  if (!prepared) prepared = idx.map((s) => ({ s, n: norm(s.t), toks: norm(s.t).split(" "), c: compactKey(s.t) }));
  const nq = norm(q);
  if (!nq) return [];
  const res = scoreSeries(prepared, nq);
  if (res.length) return res.slice(0, limit).map((r) => r[1]);
  // nothing matched word by word: fall back to close spellings of the whole title ("maruaders")
  const words = nq.split(" ").filter((t) => !/^(19|20)\d\d$/.test(t));
  const cq = compactKey(words.join(" "));
  const budget = typoBudget(cq);
  if (!budget) return [];
  const fuzzy = [];
  for (const p of prepared) {
    const d = Math.min(editDistance(cq, p.c, budget), editDistance(cq, p.c.slice(0, cq.length), budget));
    if (d <= budget) fuzzy.push([d - Math.min(p.s.n, 200) / 1000, p.s]);
  }
  fuzzy.sort((a, b) => a[0] - b[0]);
  return fuzzy.slice(0, limit).map((r) => r[1]);
}

function scoreSeries(prepared, nq) {
  const qt = nq.split(" ");
  const cq = compactKey(qt.filter((t) => !/^(19|20)\d\d$/.test(t)).join(" "));
  const years = qt.filter((t) => /^(19|20)\d\d$/.test(t)).map(Number);
  const words = qt.filter((t) => !/^(19|20)\d\d$/.test(t));
  const res = [];
  for (const p of prepared) {
    if (years.length && !years.includes(p.s.y)) {
      // a year that's part of the title (e.g. "2099") still counts as a word
      if (!years.every((y) => p.toks.includes(String(y)))) continue;
    }
    let score = 0, ok = true;
    for (const w of words) {
      const i = p.toks.findIndex((t) => t.startsWith(w));
      if (i < 0) { ok = false; break; }
      score += p.toks[i] === w ? 3 : 1;
      if (i === 0) score += 1;
    }
    // "xmen" / "spiderman": compare with spaces and punctuation removed
    if (!ok && cq.length >= 3 && p.c.includes(cq)) { ok = true; score = p.c === cq ? 8 : p.c.startsWith(cq) ? 4 : 1; }
    if (!ok) continue;
    const joined = words.join(" ");
    if (p.n === joined) score += 20;
    else if (p.n.startsWith(joined)) score += 6;
    score -= p.toks.length * 0.3;                  // prefer shorter titles
    score += Math.min(p.s.n, 200) / 100;           // and bigger runs
    if (p.s.g) score += 1;                         // and series that appear in Continuity Guide orders
    res.push([score, p.s]);
  }
  res.sort((a, b) => b[0] - a[0] || (b[1].y || 0) - (a[1].y || 0));
  return res;
}

// ---------- local storage (per device) ----------

function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode / full */ }
}

// read marks are per issue, shared across every list on this device
export const readMarks = {
  get: () => new Set(ls("cl.read", [])),
  set(set) { lsSet("cl.read", [...set]); },
};

// drafts: {id: {list, updated}}
export const drafts = {
  all: () => ls("cl.drafts", {}),
  get: (id) => drafts.all()[id],
  save(id, list) {
    const all = drafts.all();
    all[id] = { list, updated: Date.now() };
    lsSet("cl.drafts", all);
  },
  remove(id) {
    const all = drafts.all();
    delete all[id];
    lsSet("cl.drafts", all);
  },
  newId: () => Math.random().toString(36).slice(2, 10),
};

// recently opened shared lists: [{code, title, at}]
export const recent = {
  all: () => ls("cl.recent", []),
  add(code, title) {
    const r = recent.all().filter((x) => x.title !== title && x.code !== code);
    r.unshift({ code, title, at: Date.now() });
    lsSet("cl.recent", r.slice(0, 12));
  },
};
