// List editor: search series, add issues/ranges, sections, drag reorder, notes, paste import.
import {
  h, $, toast, coverUrl, issueName, seriesName, searchSeries, loadSeries, loadIndex, resolveIds,
  drafts, norm, stepper, compactKey, editDistance, typoBudget,
} from "./lib.js";

export async function renderEditor(root, list, draftId, { onPreview, onDetails }) {
  const info = new Map(); // digital id -> issue
  const ids = list.sections.flatMap((s) => s.items.filter((i) => i.id != null).map((i) => i.id));
  for (const [k, v] of await resolveIds(ids)) info.set(k, v);
  if (!list.sections.length) list.sections.push({ name: "", desc: "", items: [] });

  let target = list.sections.length - 1; // section new issues go into
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => drafts.save(draftId, list), 250);
    updateCounts();
  };
  const inList = () => new Set(list.sections.flatMap((s) => s.items.map((i) => i.id)).filter((x) => x != null));

  // ---------- list pane ----------
  const listPane = h("div", { class: "pane ed-list", id: "pane-list" });
  const details = h("div", { class: "details-card" },
    h("div", { class: "dc-text" },
      h("h1", { class: "dc-title" }, list.title || "Untitled list"),
      list.desc && h("p", { class: "dc-desc" }, list.desc)),
    h("button", { class: "btn", type: "button", onclick: onDetails }, "✎ Edit details"));
  const secWrap = h("div", { class: "sections" });

  function itemRow(it) {
    const iss = it.id != null ? info.get(it.id) : null;
    const title = iss ? issueName(iss) : it.text || `Issue ${it.id}`;
    const noteIn = h("input", { value: it.note || "", placeholder: "Note", "aria-label": "Note",
      oninput: () => { it.note = noteIn.value; noteLine.textContent = it.note; save(); } });
    const optIn = h("input", { type: "checkbox", checked: it.opt,
      onchange: () => { it.opt = optIn.checked; li.classList.toggle("opt", it.opt); save(); } });
    const noteLine = h("span", { class: "note" }, it.note || "");
    const more = h("div", { class: "more", hidden: true },
      h("label", { class: "field" }, "Note", noteIn),
      h("div", { class: "more-row" },
        h("label", { class: "toggle" }, optIn, " Optional"),
        h("button", { class: "btn danger", type: "button", onclick: () => removeItem(it) }, "Remove")));
    const li = h("li", { class: `ed-item${it.opt ? " opt" : ""}` },
      h("span", { class: "handle", "aria-hidden": "true", title: "Drag to reorder" }, "⠿"),
      iss?.cover ? h("img", { class: "thumb", src: coverUrl(iss.cover, 120), alt: "", loading: "lazy", width: 40, height: 60, referrerpolicy: "no-referrer" })
        : h("span", { class: "thumb none" }),
      h("span", { class: "t" }, h("b", {}, title), it.opt && h("span", { class: "tag" }, "optional"), noteLine),
      h("button", { class: "icon-btn", type: "button", "aria-label": `Edit ${title}`, "aria-expanded": "false", onclick: (e) => {
        more.hidden = !more.hidden;
        e.currentTarget.setAttribute("aria-expanded", !more.hidden);
        if (!more.hidden) noteIn.focus({ preventScroll: true });
      } }, "⋯"),
      more);
    li._item = it;
    return li;
  }

  function removeItem(it) {
    for (const s of list.sections) {
      const i = s.items.indexOf(it);
      if (i >= 0) s.items.splice(i, 1);
    }
    save();
    drawList();
    refreshTiles();
  }

  function drawList() {
    secWrap.replaceChildren(...list.sections.map((s, si) => {
      const ol = h("ol", { class: "ed-items", dataset: { si } }, s.items.map(itemRow));
      const nameIn = h("input", { class: "sec-name", value: s.name, placeholder: list.sections.length > 1 ? `Section ${si + 1}` : "Section name (optional)",
        "aria-label": "Section name", oninput: () => { s.name = nameIn.value; save(); drawTargets(); } });
      const blurbIn = h("input", { class: "sec-desc", value: s.desc, placeholder: "Section note (optional)", "aria-label": "Section note",
        oninput: () => { s.desc = blurbIn.value; save(); } });
      const sec = h("section", { class: `ed-sec${si === target ? " target" : ""}` },
        h("div", { class: "sec-head" },
          nameIn,
          h("div", { class: "sec-tools" },
            h("button", { class: "icon-btn", type: "button", "aria-label": "Move section up", disabled: si === 0, onclick: () => moveSec(si, -1) }, "↑"),
            h("button", { class: "icon-btn", type: "button", "aria-label": "Move section down", disabled: si === list.sections.length - 1, onclick: () => moveSec(si, 1) }, "↓"),
            list.sections.length > 1 && h("button", { class: "icon-btn", type: "button", "aria-label": "Delete section", onclick: () => delSec(si) }, "✕"))),
        blurbIn,
        ol,
        !s.items.length && h("p", { class: "empty" }, "No issues yet. ", h("button", { class: "link", type: "button", onclick: () => { target = si; drawTargets(); showTab("add"); } }, "Add some")),
        h("button", { class: `btn ghost add-here${si === target ? " on" : ""}`, type: "button", onclick: () => { target = si; drawTargets(); drawList(); showTab("add"); } },
          si === target ? "New issues go here" : "Add issues here"));
      if (window.Sortable) {
        Sortable.create(ol, {
          group: "items", handle: ".handle", animation: 150, delay: 0, ghostClass: "ghost", chosenClass: "chosen",
          onEnd: () => {
            for (const o of secWrap.querySelectorAll("ol.ed-items")) list.sections[+o.dataset.si].items = [...o.children].map((li) => li._item);
            save();
            drawList();
          },
        });
      }
      return sec;
    }));
  }

  function moveSec(si, d) {
    const [s] = list.sections.splice(si, 1);
    list.sections.splice(si + d, 0, s);
    if (target === si) target = si + d;
    else if (target === si + d) target = si;
    save(); drawList(); drawTargets();
  }
  function delSec(si) {
    const s = list.sections[si];
    if (s.items.length && !confirm(`Delete "${s.name || `Section ${si + 1}`}" and its ${s.items.length} issues?`)) return;
    list.sections.splice(si, 1);
    target = Math.min(target, list.sections.length - 1);
    save(); drawList(); drawTargets(); refreshTiles();
  }
  const addSecBtn = h("button", { class: "btn", type: "button", onclick: () => {
    list.sections.push({ name: "", desc: "", items: [] });
    target = list.sections.length - 1;
    save(); drawList(); drawTargets();
    secWrap.lastElementChild?.querySelector(".sec-name")?.focus();
  } }, "+ Section");

  // escape hatch for a bad paste import: wipe issues and sections, keep title + description
  const clearBtn = h("button", { class: "btn danger", type: "button", onclick: () => {
    const n = list.sections.reduce((a, s) => a + s.items.length, 0);
    const secs = list.sections.length;
    const what = `${n} issue${n === 1 ? "" : "s"}${secs > 1 ? ` and ${secs} sections` : ""}`;
    if (!confirm(`Remove all ${what} from "${list.title || "this list"}"?\n\nYour title and description stay. This can't be undone.`)) return;
    list.sections = [{ name: "", desc: "", items: [] }];
    target = 0;
    save(); drawList(); drawTargets(); refreshTiles();
    toast("All issues removed");
  } }, "Remove all issues");

  listPane.append(details, secWrap, h("div", { class: "pane-foot" }, addSecBtn, clearBtn));

  // ---------- add pane ----------
  const addPane = h("div", { class: "pane ed-add", id: "pane-add" });
  const targetSel = h("select", { "aria-label": "Add issues to section", onchange: () => { target = +targetSel.value; drawList(); } });
  function drawTargets() {
    targetSel.replaceChildren(...list.sections.map((s, i) => h("option", { value: i, selected: i === target }, s.name || `Section ${i + 1}`)));
    targetSel.closest(".target-row")?.toggleAttribute("hidden", list.sections.length < 2);
  }
  const searchIn = h("input", { type: "search", placeholder: "Search series, e.g. Marauders 2019", "aria-label": "Search series",
    autocomplete: "off", autocapitalize: "off", spellcheck: false, enterkeyhint: "search" });
  const results = h("div", { class: "results" });
  const seriesBox = h("div", { class: "series-view", hidden: true });
  const pasteBox = h("div", { class: "paste", hidden: true });

  let q = 0;
  searchIn.addEventListener("input", () => {
    const my = ++q;
    clearTimeout(searchIn._t);
    searchIn._t = setTimeout(async () => {
      const res = await searchSeries(searchIn.value);
      if (my !== q) return;
      seriesBox.hidden = true; results.hidden = false;
      results.replaceChildren(...(res.length ? res.map(seriesRow)
        : searchIn.value.trim() ? [h("p", { class: "empty" }, "No series found. Try fewer words, or drop the year.")] : []));
    }, 120);
  });

  function seriesRow(s) {
    const span = s.d ? (s.d[0] === s.d[1] ? s.d[0] : `${s.d[0]}–${s.d[1]}`) : "";
    const nums = s.r ? (s.r[0] === s.r[1] ? `#${s.r[0]}` : `#${s.r[0]}–${s.r[1]}`) : "";
    return h("button", { class: "res", type: "button", onclick: () => openSeries(s.id) },
      s.c ? h("img", { class: "thumb", src: coverUrl(s.c, 120), alt: "", loading: "lazy", width: 40, height: 60, referrerpolicy: "no-referrer" }) : h("span", { class: "thumb none" }),
      h("span", { class: "t" }, h("b", {}, seriesName(s.t, s.y)),
        h("span", { class: "meta" }, [nums, `${s.n} issue${s.n > 1 ? "s" : ""}`, span].filter(Boolean).join(" · "))),
      h("span", { class: "chev", "aria-hidden": "true" }, "›"));
  }

  let current; // open series
  async function openSeries(id) {
    current = await loadSeries(id);
    for (const i of current.issues) info.set(i.id, i);
    const fromIn = h("input", { inputmode: "decimal", placeholder: "from", "aria-label": "First issue", size: 4 });
    const toIn = h("input", { inputmode: "decimal", placeholder: "to", "aria-label": "Last issue", size: 4 });
    const nums = current.issues.filter((i) => i.num != null);
    if (nums.length) { fromIn.value = nums[0].num; toIn.value = nums[nums.length - 1].num; }
    seriesBox.replaceChildren(
      h("div", { class: "sv-head" },
        h("button", { class: "btn ghost", type: "button", onclick: closeSeries }, "‹ Results"),
        h("h3", {}, seriesName(current.t, current.y))),
      h("div", { class: "range" },
        h("span", {}, "Add #"), fromIn, h("span", {}, "to"), toIn,
        h("button", { class: "btn primary", type: "button", onclick: () => {
          const a = parseFloat(fromIn.value), b = parseFloat(toIn.value || fromIn.value);
          if (isNaN(a)) return toast("Enter an issue number");
          const pick = current.issues.filter((i) => i.num != null && +i.num >= Math.min(a, b) && +i.num <= Math.max(a, b));
          addIssues(pick);
        } }, "Add")),
      h("div", { class: "tiles" }, current.issues.map(tile)),
      current.cg?.length > 0 ? h("p", { class: "credit" }, "Series name from ",
        h("a", { href: "https://www.continuityguide.net/" + current.cg[0], target: "_blank", rel: "noopener" }, "Continuity Guide"), ".") : "");
    results.hidden = true; seriesBox.hidden = false;
    addPane.scrollTop = 0;
  }
  function closeSeries() { seriesBox.hidden = true; results.hidden = false; current = null; }

  function tile(i) {
    const added = inList().has(i.id);
    return h("button", { class: `tile${added ? " added" : ""}`, type: "button", dataset: { id: i.id }, "aria-pressed": String(added),
      "aria-label": `${issueName(i)}${added ? ", in list" : ""}`,
      onclick: () => (inList().has(i.id) ? removeId(i.id) : addIssues([i])) },
      i.cover ? h("img", { src: coverUrl(i.cover, 200), alt: "", loading: "lazy", width: 100, height: 150, referrerpolicy: "no-referrer" }) : h("span", { class: "noimg" }, "?"),
      h("span", { class: "num" }, i.num != null ? `#${i.num}` : "—"));
  }
  function refreshTiles() {
    const have = inList();
    for (const t of seriesBox.querySelectorAll(".tile")) {
      const on = have.has(+t.dataset.id);
      t.classList.toggle("added", on);
      t.setAttribute("aria-pressed", on);
    }
  }

  function addIssues(issues) {
    const have = inList();
    const fresh = issues.filter((i) => !have.has(i.id));
    if (!fresh.length) return toast("Already in the list");
    list.sections[target].items.push(...fresh.map((i) => ({ id: i.id, opt: false, note: "" })));
    save(); drawList(); refreshTiles();
    toast(fresh.length === 1 ? `Added ${issueName(fresh[0])}` : `Added ${fresh.length} issues`);
  }
  function removeId(id) {
    for (const s of list.sections) s.items = s.items.filter((i) => i.id !== id);
    save(); drawList(); refreshTiles();
    toast("Removed");
  }

  // paste import
  const pasteIn = h("textarea", { rows: 8, placeholder: "One per line, e.g.\n# House of X\nHouse of X (2019) #1\nPowers of X #1-2 (2019)\nMarauders 2019 #1-6\nX-Men #1", "aria-label": "Paste a reading order" });
  const pasteOut = h("div", { class: "paste-out", "aria-live": "polite" });
  const importBtn = h("button", { class: "btn primary", type: "button", onclick: runImport }, "Import");
  pasteBox.append(
    h("p", { class: "hint" }, "Paste a reading order. Lines starting with # become sections. If a title matches more than one series, we'll ask which one. Anything we can't match is kept as a title you can copy into the app's search."),
    pasteIn, importBtn, pasteOut);

  async function runImport() {
    if (!pasteIn.value.trim()) return toast("Paste some lines first");
    importBtn.disabled = true;
    importBtn.textContent = "Matching…";
    try {
      const { plan, questions } = await planImport(pasteIn.value);
      if (!questions.length) return await finishImport(plan, new Map());
      askSeries(plan, questions);
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = "Import";
    }
  }

  // "X-Men #1" matches several series: ask once per title, suggestion preselected
  function askSeries(plan, questions) {
    const choices = new Map(questions.map((q) => [q.key, q.suggested]));
    const opt = (q, i, c) => {
      const s = c.s;
      const range = s.r ? (s.r[0] === s.r[1] ? `#${s.r[0]}` : `#${s.r[0]}–${s.r[1]}`) : "";
      const years = s.d ? (s.d[0] === s.d[1] ? s.d[0] : `${s.d[0]}–${s.d[1]}`) : "";
      return h("label", { class: `amb-opt${c.hits ? "" : " none"}` },
        h("input", { type: "radio", name: `amb-${i}`, checked: s.id === q.suggested, onchange: () => choices.set(q.key, s.id) }),
        s.c ? h("img", { class: "thumb", src: coverUrl(s.c, 120), alt: "", loading: "lazy", width: 40, height: 60, referrerpolicy: "no-referrer" }) : h("span", { class: "thumb none" }),
        h("span", { class: "t" },
          h("b", {}, seriesName(s.t, s.y)), s.id === q.suggested ? h("span", { class: "tag sugg" }, "suggested") : "",
          h("span", { class: "meta" }, [range, years].filter(Boolean).join(" · ")),
          h("span", { class: "meta hits" }, c.hits === q.want ? `Has all ${q.want === 1 ? "of it" : q.want}` : `Has ${c.hits} of ${q.want}`)));
    };
    pasteOut.replaceChildren(
      h("div", { class: "amb-wrap" },
        h("h3", {}, questions.length === 1 ? "One title needs a closer look" : `${questions.length} titles need a closer look`),
        h("p", { class: "hint" }, "These match more than one series, or look misspelled. Pick the right one for each; your choice applies to every line with that title."),
        questions.map((q, i) => {
          const good = q.cands.filter((c) => c.hits > 0), rest = q.cands.filter((c) => !c.hits);
          return h("fieldset", { class: "amb" },
            h("legend", {}, h("b", {}, q.fuzzy ? `"${q.title}": did you mean…?` : q.year ? `${q.title} (${q.year})` : q.title),
              h("span", { class: "meta" }, `${q.year && !q.cands.some((c) => c.s.y === q.year) ? `No ${q.year} series found. ` : ""}Lines: ${q.lines.slice(0, 8).join(", ")}${q.lines.length > 8 ? "…" : ""}`)),
            good.map((c) => opt(q, i, c)),
            rest.length ? h("details", {}, h("summary", {}, `${rest.length} other series named "${q.title}" without these issues`), rest.map((c) => opt(q, i, c))) : "",
            h("label", { class: "amb-opt skip" },
              h("input", { type: "radio", name: `amb-${i}`, checked: q.suggested == null, onchange: () => choices.set(q.key, null) }),
              h("span", { class: "t" }, h("b", {}, "None of these"), h("span", { class: "meta" }, "Keep these lines as copyable titles"))));
        }),
        h("div", { class: "form-acts" },
          h("button", { class: "btn primary big", type: "button", onclick: () => finishImport(plan, choices) }, "Finish import"),
          h("button", { class: "btn big", type: "button", onclick: () => pasteOut.replaceChildren() }, "Cancel"))));
    pasteOut.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function finishImport(plan, choices) {
    const r = await applyPlan(plan, choices, list, target, info);
    target = list.sections.length - 1;
    save(); drawList(); drawTargets(); refreshTiles();
    pasteOut.replaceChildren(h("p", {}, `Added ${r.added} issue${r.added === 1 ? "" : "s"}.`),
      r.missed.length ? h("details", { open: r.missed.length < 6 }, h("summary", {}, `${r.missed.length} not found (kept as copyable titles)`),
        h("ul", {}, r.missed.map((m) => h("li", {}, m)))) : "");
    if (r.added) toast(`Imported ${r.added} issues`);
  }

  const modeSearch = h("button", { class: "seg on", type: "button", "aria-pressed": "true", onclick: () => mode("search") }, "Search");
  const modePaste = h("button", { class: "seg", type: "button", "aria-pressed": "false", onclick: () => mode("paste") }, "Paste a list");
  function mode(m) {
    modeSearch.classList.toggle("on", m === "search"); modeSearch.setAttribute("aria-pressed", m === "search");
    modePaste.classList.toggle("on", m === "paste"); modePaste.setAttribute("aria-pressed", m === "paste");
    $(".search-ui", addPane).hidden = m !== "search";
    pasteBox.hidden = m !== "paste";
  }

  addPane.append(
    h("div", { class: "add-top" },
      h("div", { class: "segs", role: "group", "aria-label": "Add issues by" }, modeSearch, modePaste),
      h("label", { class: "target-row" }, "Add to ", targetSel)),
    h("div", { class: "search-ui" }, searchIn, results, seriesBox),
    pasteBox);

  const preview = () => {
    if (!list.sections.some((s) => s.items.length)) return toast("Add at least one issue first");
    drafts.save(draftId, list);
    onPreview();
  };

  // ---------- layout: two panes on tablet/desktop, tabs on phone ----------
  const count = h("span", { class: "badge" });
  function updateCounts() {
    const n = list.sections.reduce((a, s) => a + s.items.length, 0);
    clearBtn.hidden = !n && list.sections.length < 2;
    count.textContent = n;
  }
  const tabs = h("nav", { class: "tabbar", "aria-label": "Editor" },
    h("button", { type: "button", dataset: { tab: "add" }, onclick: () => showTab("add") }, h("span", {}, "Add issues")),
    h("button", { type: "button", dataset: { tab: "list" }, onclick: () => showTab("list") }, h("span", {}, "Your list"), count),
    h("button", { class: "tab-cta", type: "button", onclick: preview }, h("span", {}, "Preview & share →")));
  function showTab(t) {
    root.dataset.tab = t;
    for (const b of tabs.querySelectorAll("[data-tab]")) b.setAttribute("aria-current", b.dataset.tab === t ? "page" : "false");
    if (t === "add" && matchMedia("(max-width: 899px)").matches) setTimeout(() => { if (!current) searchIn.focus({ preventScroll: true }); }, 50);
    window.scrollTo(0, 0);
  }

  root.replaceChildren(
    h("div", { class: "ed-bar" },
      stepper("d", draftId),
      h("div", { class: "head-acts" },
        h("span", { class: "saved" }, "Saved on this device"),
        h("button", { class: "btn primary", type: "button", onclick: preview }, "Preview & share →"))),
    h("div", { class: "editor" }, listPane, addPane),
    tabs);
  drawList(); drawTargets(); updateCounts();
  showTab(list.sections.some((s) => s.items.length) ? "list" : "add");
  loadIndex(); // warm the search index
}

// ---------- paste import ----------

const LINE = /^(.*?)\s*(?:\((\d{4})\)|\b(\d{4})\b)?\s*(?:#|\bissues?\s+|\s)\s*(\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*#?\s*(\d+(?:\.\d+)?))?\s*$/i;

// "X-Men #1 (2019)" or "X-Men #1-6 (2019)": year after the number
const YEAR_AFTER = /^(.*?)\s*(#\s*\d[\d.]*(?:\s*(?:-|–|—|to)\s*#?\s*\d[\d.]*)?)\s*\((\d{4})\)\s*$/i;

export function parseLine(line) {
  const ya = line.match(YEAR_AFTER);
  if (ya) line = `${ya[1]} (${ya[3]}) ${ya[2]}`;
  const m = line.match(LINE);
  if (!m || !m[1].trim()) return null;
  // a bare 4-digit number may be part of the title ("X-Men 2099"), so keep that reading too
  const title = m[1].replace(/[,:\s]+$/, "").trim();
  return { title, year: +(m[2] || m[3]) || null, alt: m[3] ? `${title} ${m[3]}` : null, a: +m[4], b: +(m[5] || m[4]) };
}

// Two passes so ambiguous titles can be asked about before anything is added:
// planImport() parses and matches every line; applyPlan() adds them in order once choices are made.

// lookup(title) -> {cands, fuzzy}. Exact on the spelling-insensitive key ("xmen" = "X-Men");
// otherwise the closest titles within a small typo budget, flagged fuzzy so the user confirms.
function titleIndex(idx) {
  const byKey = new Map();
  for (const s of idx) {
    const k = compactKey(s.t);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }
  const keys = [...byKey.keys()];
  return (t) => {
    const k = compactKey(t);
    if (byKey.has(k)) return { cands: byKey.get(k), fuzzy: false };
    const budget = typoBudget(k);
    if (!budget) return { cands: [], fuzzy: false };
    let best = budget + 1, hits = [];
    for (const key of keys) {
      const d = editDistance(k, key, budget);
      if (d < best) { best = d; hits = [key]; } else if (d === best) hits.push(key);
    }
    return best <= budget ? { cands: hits.flatMap((key) => byKey.get(key)), fuzzy: true } : { cands: [], fuzzy: false };
  };
}

const nums = (p) => {
  const out = [];
  for (let n = p.a; n <= p.b && out.length <= 500; n++) out.push(n);
  return out;
};

async function hitsIn(sid, wanted) {
  const s = await loadSeries(sid).catch(() => null);
  if (!s) return 0;
  const have = new Set(s.issues.filter((i) => i.num != null).map((i) => +i.num));
  return wanted.filter((n) => have.has(n)).length;
}

export async function planImport(text) {
  const lookup = titleIndex(await loadIndex());
  const plan = [];
  const questions = new Map(); // key -> {key, title, year, lines, wanted:Set, cands}
  const knownYears = [];

  for (let raw of text.split(/\r?\n/)) {
    raw = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!raw) continue;
    const head = raw.match(/^#{1,6}\s*(.+)$/) || raw.match(/^(.+):$/);
    if (head) { plan.push({ kind: "section", name: head[1].trim() }); continue; }
    const p = parseLine(raw);
    if (!p) { plan.push({ kind: "text", text: raw }); continue; }

    const L = lookup(p.title);
    const all = L.cands;
    let fuzzy = L.fuzzy;
    let cands = p.year ? all.filter((c) => c.y === p.year) : all;
    if (!cands.length && p.alt) { const A = lookup(p.alt); cands = A.cands; fuzzy = A.fuzzy; } // "X-Men 2099 #1": the number was part of the title
    if (!cands.length && p.year && all.length) cands = all; // year given but no series has it: ask
    if (cands.length === 1 && !fuzzy) {
      plan.push({ kind: "issue", p, sid: cands[0].id });
      if (cands[0].y) knownYears.push(cands[0].y);
      continue;
    }
    if (!cands.length) { plan.push({ kind: "issue", p, sid: null }); continue; }

    // several series share this title: if exactly one actually has these issues, take it
    const wanted = nums(p);
    const hits = await Promise.all(cands.map((c) => hitsIn(c.id, wanted)));
    const withHits = cands.filter((_, i) => hits[i] > 0);
    if (withHits.length === 1 && !fuzzy && !(p.year && withHits[0].y !== p.year)) {
      plan.push({ kind: "issue", p, sid: withHits[0].id });
      if (withHits[0].y) knownYears.push(withHits[0].y);
      continue;
    }
    const key = `${compactKey(p.title)}|${p.year || ""}`;
    if (!questions.has(key)) questions.set(key, { key, title: p.title, year: p.year, fuzzy, lines: [], wanted: new Set(), cands });
    const q = questions.get(key);
    q.lines.push(p.a === p.b ? `#${p.a}` : `#${p.a}–${p.b}`);
    wanted.forEach((n) => q.wanted.add(n));
    plan.push({ kind: "issue", p, q: key });
  }

  // score each question's candidates and pick a suggestion: the series closest in time
  // to the rest of this import, among those that have the most of the wanted issues
  const mid = knownYears.length ? knownYears.sort((a, b) => a - b)[Math.floor(knownYears.length / 2)] : null;
  const qs = [];
  for (const q of questions.values()) {
    const wanted = [...q.wanted];
    const scored = await Promise.all(q.cands.map(async (s) => ({ s, hits: await hitsIn(s.id, wanted) })));
    const best = Math.max(...scored.map((c) => c.hits));
    const pool = scored.filter((c) => c.hits === best);
    const pick = mid != null
      ? pool.reduce((a, b) => (Math.abs((b.s.y || 0) - mid) < Math.abs((a.s.y || 0) - mid) ? b : a))
      : pool.reduce((a, b) => (b.s.n > a.s.n ? b : a));
    scored.sort((a, b) => b.hits - a.hits || (b.s.y || 0) - (a.s.y || 0));
    qs.push({ ...q, want: wanted.length, cands: scored, suggested: best > 0 ? pick.s.id : null });
  }
  return { plan, questions: qs };
}

// choices: question key -> series id, or null to keep those lines as text
export async function applyPlan(plan, choices, list, target, info) {
  let sec = list.sections[target];
  let added = 0;
  const missed = [];
  for (const e of plan) {
    if (e.kind === "section") {
      if (sec.items.length || sec.name) list.sections.push((sec = { name: e.name, desc: "", items: [] }));
      else sec.name = e.name;
      continue;
    }
    if (e.kind === "text") { missed.push(e.text); sec.items.push({ text: e.text, opt: false, note: "" }); continue; }
    const sid = e.q ? choices.get(e.q) : e.sid;
    const s = sid ? await loadSeries(sid).catch(() => null) : null;
    for (const n of nums(e.p)) {
      const iss = s?.issues.find((i) => i.num != null && +i.num === n);
      if (iss) {
        if (!sec.items.some((x) => x.id === iss.id)) {
          info.set(iss.id, iss);
          sec.items.push({ id: iss.id, opt: false, note: "" });
          added++;
        }
        continue;
      }
      const label = s ? `${seriesName(s.t, s.y)} #${n}` : `${e.p.title}${e.p.year ? ` (${e.p.year})` : ""} #${n}`;
      missed.push(label);
      sec.items.push({ text: label, opt: false, note: "" });
    }
  }
  return { added, missed };
}
