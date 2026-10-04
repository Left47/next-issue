// List editor: search series, add issues/ranges, sections, drag reorder, notes, paste import.
import {
  h, $, toast, coverUrl, issueName, seriesName, searchSeries, loadSeries, loadIndex, resolveIds,
  drafts, norm, stepper,
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

  listPane.append(details, secWrap, h("div", { class: "pane-foot" }, addSecBtn));

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
      current.cg?.length > 0 && h("p", { class: "credit" }, "Series name from ",
        h("a", { href: "https://www.continuityguide.net/" + current.cg[0], target: "_blank", rel: "noopener" }, "Continuity Guide"), "."));
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
  const pasteIn = h("textarea", { rows: 8, placeholder: "One per line, e.g.\n# House of X\nHouse of X (2019) #1\nPowers of X (2019) #1-2\nMarauders 2019 #1-6\nX-Men #1", "aria-label": "Paste a reading order" });
  const pasteOut = h("div", { class: "paste-out", "aria-live": "polite" });
  pasteBox.append(
    h("p", { class: "hint" }, "Paste a reading order. Lines starting with # become sections. Anything we can't match is kept as a title you can copy into the app's search."),
    pasteIn,
    h("button", { class: "btn primary", type: "button", onclick: async () => {
      const r = await importText(pasteIn.value, list, target, info);
      target = list.sections.length - 1;
      save(); drawList(); drawTargets(); refreshTiles();
      pasteOut.replaceChildren(h("p", {}, `Added ${r.added} issue${r.added === 1 ? "" : "s"}.`),
        r.missed.length ? h("details", { open: r.missed.length < 6 }, h("summary", {}, `${r.missed.length} not found (kept as copyable titles)`),
          h("ul", {}, r.missed.map((m) => h("li", {}, m)))) : "");
      if (r.added) toast(`Imported ${r.added} issues`);
    } }, "Import"),
    pasteOut);

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

export function parseLine(line) {
  const m = line.match(LINE);
  if (!m || !m[1].trim()) return null;
  // a bare 4-digit number may be part of the title ("X-Men 2099"), so keep that reading too
  const title = m[1].replace(/[,:\s]+$/, "").trim();
  return { title, year: +(m[2] || m[3]) || null, alt: m[3] ? `${title} ${m[3]}` : null, a: +m[4], b: +(m[5] || m[4]) };
}

export async function importText(text, list, target, info) {
  const idx = await loadIndex();
  const byTitle = new Map();
  for (const s of idx) {
    const k = norm(s.t);
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(s);
  }
  let sec = list.sections[target];
  let added = 0;
  const missed = [];
  for (let raw of text.split(/\r?\n/)) {
    raw = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!raw) continue;
    const head = raw.match(/^#{1,6}\s*(.+)$/) || raw.match(/^(.+):$/);
    if (head) {
      if (sec.items.length || sec.name) list.sections.push((sec = { name: head[1].trim(), desc: "", items: [] }));
      else sec.name = head[1].trim();
      continue;
    }
    const p = parseLine(raw);
    if (!p) { missed.push(raw); sec.items.push({ text: raw, opt: false, note: "" }); continue; }
    let cands = byTitle.get(norm(p.title)) || byTitle.get(norm(p.title.replace(/^the\s+/i, ""))) || [];
    if (p.year) cands = cands.filter((c) => c.y === p.year);
    if (!cands.length && p.alt) cands = byTitle.get(norm(p.alt)) || [];
    // prefer a volume whose numbering covers the requested issues, then the bigger run
    cands = [...cands].sort((x, y) => covers(y, p) - covers(x, p) || y.n - x.n);
    const s = cands[0] && (await loadSeries(cands[0].id).catch(() => null));
    for (let n = p.a; n <= p.b; n++) {
      const iss = s?.issues.find((i) => i.num != null && +i.num === n);
      const label = `${p.title}${p.year ? ` (${p.year})` : ""} #${n}`;
      if (iss && !sec.items.some((x) => x.id === iss.id)) {
        info.set(iss.id, iss);
        sec.items.push({ id: iss.id, opt: false, note: "" });
        added++;
      } else if (!iss) {
        missed.push(label);
        sec.items.push({ text: label, opt: false, note: "" });
      }
      if (p.b - p.a > 500) break;
    }
  }
  return { added, missed };
}

function covers(s, p) {
  return s.r && +s.r[0] <= p.a && +s.r[1] >= p.b ? 1 : 0;
}
