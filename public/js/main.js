// Router + home page.
import { h, $, copyText, decodeList, encodeList, expand, shareUrl, shareLink, stepper, drafts, recent, CG } from "./lib.js";
import { renderView } from "./view.js";
import { renderEditor } from "./edit.js";

const app = $("#app");
const FEATURED = [
  { id: "dawn-of-x", title: "Dawn of X", blurb: "House of X / Powers of X through X of Swords, issue by issue." },
];

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const hash = location.hash.slice(1);
  const [key, ...rest] = hash.split("=");
  const val = rest.join("=");
  app.className = "";
  delete app.dataset.tab;
  document.body.classList.remove("editing");
  window.scrollTo(0, 0);
  try {
    if (key === "l" && val) return await showShared(val);
    if (key === "f" && val) return await showFeatured(val);
    if (key === "i" && val) return showDetails(val);
    if (key === "d" && val) return await showDraft(val);
    if (key === "p" && val) return await showPreview(val);
    if (key === "new") return newDraft(null, true);
    return home();
  } catch (e) {
    console.error(e);
    app.replaceChildren(h("div", { class: "wrap" },
      h("h1", {}, "Couldn't open that"),
      h("p", { class: "lede" }, "The link may be cut off or from a newer version of the site. ", h("a", { href: "#" }, "Go home"), ".")));
  }
}

function setTitle(t) {
  document.title = t ? `${t} · Next Issue` : "Next Issue · Comic reading lists for Marvel Unlimited";
}

function newDraft(list, replace = false) {
  const id = drafts.newId();
  drafts.save(id, list || { title: "", desc: "", sections: [{ name: "", desc: "", items: [] }] });
  if (replace) location.replace(`#i=${id}`); // don't leave "#new" in history, or Back would make another draft
  else go(`#i=${id}`);
}

async function showShared(code) {
  const list = await decodeList(code);
  recent.add(code, list.title || "Untitled list");
  setTitle(list.title);
  app.className = "wrap";
  await renderView(app, list, {
    code,
    onShare: () => shareLink(shareUrl(code), list.title),
    onCopyEdit: () => newDraft(structuredClone(list)),
  });
}

async function showFeatured(id) {
  const r = await fetch(`lists/${id}.json`);
  if (!r.ok) throw new Error("no such list");
  const list = expand(await r.json());
  setTitle(list.title);
  app.className = "wrap";
  await renderView(app, list, {
    featured: true,
    onShare: () => shareLink(`${location.origin}${location.pathname}#f=${id}`, list.title),
    onCopyEdit: () => newDraft(structuredClone(list)),
  });
}

// Step 1: title + description
function showDetails(id) {
  const d = drafts.get(id);
  if (!d) throw new Error("no draft");
  const list = d.list;
  const fresh = !list.sections.some((s) => s.items.length);
  setTitle(list.title || "New list");
  app.className = "wrap narrow";
  const titleIn = h("input", { id: "f-title", value: list.title, placeholder: "e.g. Krakoa for beginners", autocomplete: "off", enterkeyhint: "next", required: true });
  const descIn = h("textarea", { id: "f-desc", rows: 4, placeholder: "What's this list for? Where should people start?" }, list.desc);
  const submit = (e) => {
    e.preventDefault();
    list.title = titleIn.value.trim();
    list.desc = descIn.value.trim();
    if (!list.title) { titleIn.focus(); titleIn.setAttribute("aria-invalid", "true"); return; }
    drafts.save(id, list);
    go(`#d=${id}`);
  };
  app.replaceChildren(
    stepper("i", id),
    h("form", { class: "details-form", onsubmit: submit, novalidate: true },
      h("h1", {}, fresh ? "Name your list" : "List details"),
      h("label", { class: "fld", for: "f-title" }, h("span", {}, "Title"), titleIn),
      h("label", { class: "fld", for: "f-desc" }, h("span", {}, "Description ", h("em", {}, "optional")), descIn),
      h("div", { class: "form-acts" },
        h("button", { class: "btn primary big", type: "submit" }, fresh ? "Next: add issues →" : "Save details"),
        !fresh && h("a", { class: "btn big", href: `#d=${id}` }, "Cancel"))));
  if (!list.title) setTimeout(() => titleIn.focus(), 50);
}

// Step 2: add issues
async function showDraft(id) {
  const d = drafts.get(id);
  if (!d) throw new Error("no draft");
  if (!d.list.title && !d.list.sections.some((s) => s.items.length)) return location.replace(`#i=${id}`);
  setTitle(d.list.title || "New list");
  document.body.classList.add("editing");
  app.className = "ed-root";
  await renderEditor(app, d.list, id, { onPreview: () => go(`#p=${id}`), onDetails: () => go(`#i=${id}`) });
}

// Step 3: preview + share
async function showPreview(id) {
  const d = drafts.get(id);
  if (!d) throw new Error("no draft");
  setTitle(d.list.title);
  app.className = "wrap";
  const url = shareUrl(await encodeList(d.list));
  const n = d.list.sections.reduce((a, s) => a + s.items.length, 0);
  const urlIn = h("input", { class: "share-url", value: url, readonly: true, "aria-label": "Share link", onfocus: (e) => e.target.select() });
  await renderView(app, d.list, {});
  app.prepend(
    stepper("p", id),
    h("section", { class: "share-panel" },
      h("h2", {}, "Ready to share"),
      h("p", {}, `Anyone with this link sees your ${n}-issue list and can open each issue in Marvel Unlimited. The list lives in the link itself, so if you edit it later, share the new link.`),
      urlIn,
      h("div", { class: "share-acts" },
        h("button", { class: "btn primary big", type: "button", onclick: () => shareLink(url, d.list.title) }, "Share link"),
        h("button", { class: "btn big", type: "button", onclick: () => copyText(url, "Link copied") }, "Copy link"),
        h("a", { class: "btn big", href: `#d=${id}` }, "← Edit list"))));
}

function home() {
  setTitle();
  app.className = "wrap home";
  const count = (l) => l.sections.reduce((a, s) => a + s.items.length, 0);
  // forget drafts that were opened but never filled in
  for (const [id, d] of Object.entries(drafts.all())) if (!d.list.title && !count(d.list)) drafts.remove(id);
  const mine = Object.entries(drafts.all()).sort((a, b) => b[1].updated - a[1].updated);
  const seen = recent.all();

  app.replaceChildren(h("div", { class: "home-in" },
    h("header", { class: "hero" },
      h("p", { class: "eyebrow" }, "Unofficial companion for Marvel Unlimited subscribers"),
      h("h1", { class: "hero-h" }, "Build & share ", h("span", { class: "nw" }, "Marvel reading lists")),
      h("p", { class: "subhead" }, "Always read the right ", h("span", { class: "wm" }, "Next ", h("span", {}, "Issue"))),
      h("p", { class: "lede" }, "Search the comics, put the issues in reading order, and send the link. Every issue opens straight in the Marvel Unlimited app with one tap. No account needed."),
      h("div", { class: "cta" },
        h("button", { class: "btn primary big", type: "button", onclick: () => newDraft() }, "Start a list"),
        h("a", { class: "btn big", href: "#f=dawn-of-x" }, "See an example"))),

    mine.length > 0 && h("section", {},
      h("h2", {}, "Your lists"),
      h("ul", { class: "cards" }, mine.map(([id, d]) => h("li", { class: "card" },
        h("a", { href: `#p=${id}`, class: "card-main" },
          h("b", {}, d.list.title || "Untitled list"),
          h("span", { class: "meta" }, `${count(d.list)} issues · edited ${ago(d.updated)}`)),
        h("div", { class: "card-acts" },
          h("a", { class: "btn", href: `#d=${id}` }, "Edit"),
          h("button", { class: "icon-btn", type: "button", "aria-label": `Delete ${d.list.title || "untitled list"}`, onclick: () => {
            if (!confirm(`Delete "${d.list.title || "Untitled list"}" from this device? Links you've already shared keep working.`)) return;
            drafts.remove(id); home();
          } }, "✕")))))),

    seen.length > 0 && h("section", {},
      h("h2", {}, "Recently opened"),
      h("ul", { class: "cards" }, seen.map((r) => h("li", { class: "card" },
        h("a", { href: `#l=${r.code}`, class: "card-main" }, h("b", {}, r.title), h("span", { class: "meta" }, `opened ${ago(r.at)}`)))))),

    h("section", {},
      h("h2", {}, "Featured"),
      h("ul", { class: "cards" }, FEATURED.map((f) => h("li", { class: "card" },
        h("a", { href: `#f=${f.id}`, class: "card-main" }, h("b", {}, f.title), h("span", { class: "meta" }, f.blurb)))))),

    h("section", { class: "how" },
      h("h2", {}, "How it works"),
      h("ol", {},
        h("li", {}, h("b", {}, "Search a series"), " and tap issues to add them, or add a whole range at once."),
        h("li", {}, h("b", {}, "Or paste a list"), " you already have, like lines of ", h("code", {}, "Marauders (2019) #1-6"), "."),
        h("li", {}, h("b", {}, "Drag to reorder,"), " split into sections, and add notes."),
        h("li", {}, h("b", {}, "Share the link."), " The whole list lives in the link, so nothing is stored on a server."))),

    h("footer", { class: "foot" },
      h("p", {}, h("b", {}, "Unofficial. "), "Not affiliated with or endorsed by Marvel. You need your own Marvel Unlimited subscription to read. Covers are loaded from Marvel's servers."),
      h("p", {}, "Series names and many issue links come from ",
        h("a", { href: CG, target: "_blank", rel: "noopener" }, "Continuity Guide"),
        ", which has excellent hand-built reading orders for the ",
        h("a", { href: `${CG}/marvel-modern`, target: "_blank", rel: "noopener" }, "modern"), " and ",
        h("a", { href: `${CG}/marvel-premodern`, target: "_blank", rel: "noopener" }, "classic"),
        " Marvel eras. Go read those."))));
}

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

addEventListener("hashchange", route);
route();
