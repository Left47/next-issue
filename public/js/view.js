// List viewer: numbered checklist, one-tap app links, progress, jump to next.
import { h, $, appLink, coverUrl, issueName, copyText, toast, readMarks, resolveIds, loadSeries, CG } from "./lib.js";

export async function renderView(root, list, { code, onEdit, onCopyEdit, onShare, featured } = {}) {
  const ids = list.sections.flatMap((s) => s.items.filter((i) => i.id != null).map((i) => i.id));
  const issues = await resolveIds(ids);
  const marks = readMarks.get();
  const keyOf = (it) => (it.id != null ? `d${it.id}` : `t${it.text}`);

  const rows = [];
  let n = 0;
  const cgPages = new Set();

  const sections = list.sections.map((s) => {
    const lis = s.items.map((it) => {
      n++;
      const iss = it.id != null ? issues.get(it.id) : null;
      const title = iss ? issueName(iss) : it.text || `Unknown issue ${it.id}`;
      const key = keyOf(it);
      const li = h("li", { class: `item${it.opt ? " opt" : ""}${marks.has(key) ? " done" : ""}`, dataset: { key } });
      const box = h("input", { type: "checkbox", checked: marks.has(key), "aria-label": `Mark ${title} as read`,
        onchange: () => setRead(li, key, box.checked) });
      const act = iss
        ? h("a", { class: "btn read", href: appLink(iss), target: "_blank", rel: "noopener",
            onclick: () => { box.checked = true; setRead(li, key, true); returning = true; } }, "Read")
        : h("button", { class: "btn read", type: "button", onclick: () => copyText(title, "Title copied: paste it into the app's search") }, "Copy");
      li.append(
        h("span", { class: "n" }, n),
        h("label", { class: "chk" }, box),
        iss?.cover
          ? h("img", { class: "thumb", src: coverUrl(iss.cover, 120), alt: "", loading: "lazy", width: 40, height: 60, referrerpolicy: "no-referrer" })
          : h("span", { class: "thumb none" }),
        h("span", { class: "t" },
          h("b", {}, title),
          it.opt && h("span", { class: "tag" }, "optional"),
          iss?.date && h("span", { class: "meta" }, fmtDate(iss.date)),
          it.note && h("span", { class: "note" }, it.note),
          !iss && h("span", { class: "note" }, "No direct link. Tap Copy, then paste the title into the app's search.")),
        act);
      rows.push(li);
      return li;
    });
    return h("section", { class: "phase" },
      s.name && h("h2", {}, s.name),
      s.desc && h("p", { class: "blurb" }, s.desc),
      h("ol", { class: "items" }, lis));
  });

  // Continuity Guide credit: link to their curated orders that cover issues in this list
  // (needs the series files; only loaded for a handful of series)
  const sids = [...new Set([...issues.values()].map((i) => i.sid))].slice(0, 40);
  Promise.all(sids.map((sid) => loadSeries(sid).catch(() => null))).then((all) => {
      for (const s of all) for (const p of s?.cg || []) cgPages.add(p);
      if (cgPages.size) {
        $("#cg-credit", root)?.replaceChildren(
          "Want a curated reading order? ",
          h("a", { href: CG, target: "_blank", rel: "noopener" }, "Continuity Guide"),
          " covers these series in: ",
          ...[...cgPages].slice(0, 8).flatMap((p, i) => [i ? ", " : "", h("a", { href: `${CG}/${p}`, target: "_blank", rel: "noopener" }, pageName(p))]),
          ".");
      }
    });

  const fill = h("i");
  const count = h("span", { class: "count" });
  const hideBtn = h("button", { class: "btn", type: "button", "aria-pressed": "false", onclick: () => {
    const on = root.classList.toggle("hide-done");
    hideBtn.setAttribute("aria-pressed", on);
    hideBtn.textContent = on ? "Show read" : "Hide read";
  } }, "Hide read");

  function setRead(li, key, on) {
    const m = readMarks.get();
    on ? m.add(key) : m.delete(key);
    readMarks.set(m);
    li.classList.toggle("done", on);
    update();
  }
  function update() {
    const done = rows.filter((r) => r.classList.contains("done")).length;
    fill.style.width = rows.length ? `${(100 * done) / rows.length}%` : "0";
    count.textContent = `${done} / ${rows.length}`;
    rows.forEach((r) => r.classList.remove("next"));
    rows.find((r) => !r.classList.contains("done"))?.classList.add("next");
  }
  // coming back from the Marvel app after tapping Read: bring the next issue into view
  let returning = false;
  const onVis = () => {
    if (document.visibilityState !== "visible" || !returning) return;
    returning = false;
    if (!root.isConnected || !rows[0]?.isConnected) return document.removeEventListener("visibilitychange", onVis);
    setTimeout(jump, 300);
  };
  document.addEventListener("visibilitychange", onVis);

  function jump() {
    const next = rows.find((r) => !r.classList.contains("done"));
    if (!next) return toast("All read!");
    next.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }

  const missing = list.sections.reduce((a, s) => a + s.items.filter((i) => i.id == null || !issues.has(i.id)).length, 0);

  root.replaceChildren(
    h("header", { class: "list-head" },
      featured && h("p", { class: "eyebrow" }, "Featured list"),
      h("h1", {}, list.title || "Untitled list"),
      list.desc && h("p", { class: "lede" }, list.desc),
      h("div", { class: "head-acts" },
        onShare && h("button", { class: "btn", type: "button", onclick: onShare }, "Share"),
        onEdit && h("button", { class: "btn", type: "button", onclick: onEdit }, "Edit"),
        onCopyEdit && h("button", { class: "btn", type: "button", onclick: onCopyEdit }, "Copy & edit"))),
    h("div", { class: "bar" },
      h("div", { class: "meter", "aria-hidden": "true" }, fill),
      count,
      h("button", { class: "btn primary", type: "button", onclick: jump }, "Jump to next"),
      hideBtn),
    ...sections,
    h("footer", { class: "foot" },
      h("p", {}, "Tap Read to open the issue in the Marvel Unlimited app (you need your own subscription). Checkmarks are saved on this device only.",
        missing ? ` ${missing} issue${missing > 1 ? "s" : ""} couldn't be linked; use Copy for those.` : ""),
      h("p", { id: "cg-credit" })));
  update();
}

function fmtDate(d) {
  const [y, m] = d.split("-");
  return m ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m - 1]} ${y}` : y;
}

function pageName(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
