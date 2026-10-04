# Next Issue

A free website for building comic reading lists and sharing them as links. Every issue opens straight in the **Marvel Unlimited** app with one tap.

Unofficial. Not affiliated with Marvel. Readers need their own Marvel Unlimited subscription; this only makes the subscription easier to use. If Marvel adds shareable reading lists to the app, this site should retire.

**Live at [nextissue.in](https://nextissue.in)**

## Features

- **One-tap open in Marvel Unlimited.** Every issue opens straight to that issue in the app. Issues without a direct link get a Copy button for the title.
- **Lists live entirely in the link.** The whole list (title, sections, notes, issue order) is compressed into the URL. Nothing to sign up for on this site, and no server database. Anyone with the link sees the same list, and a 131-issue list fits in about 700 characters.
- **Progress tracking.** A sticky "Next issue in <list>" bar always shows where you are, with a Read button. Tapping Read marks the issue and moves you on. Checkmarks are saved on your device and carry across lists, so an issue you read in one list shows as read in every other.
- **Fast list building.** Search the Marvel Unlimited catalog by series, tap covers to add issues, add a whole range (#1–12) at once, or paste an existing reading order as text (`Marauders (2019) #1-6`, one per line).
- **Real reading orders, not just pull lists.** Sections, notes per issue, optional side-reads, and drag-to-reorder for interleaved events and crossovers.
- **Phone- and tablet-first.** Built for reading on the device that has the app: large tap targets, a bottom tab bar on phones, a two-pane editor on tablets, the native share sheet, and add-to-home-screen.
- **Free, with a catalog that keeps up.** Static site with no running costs. The catalog refreshes weekly to pick up new releases.

## Layout

| Path | What |
|---|---|
| `public/` | The static site (no build step). Deploy this folder. |
| `public/js/lib.js` | List codec (deflate + base64url in the URL hash), catalog data access, search, local storage |
| `public/js/view.js` | List viewer: checkmarks, progress, jump to next, one-tap Read links |
| `public/js/edit.js` | Editor: series search, issue grid, ranges, sections, drag reorder (SortableJS), notes, paste import |
| `public/data/` | Generated catalog: `series.json` (search index), `s/<series>.json`, `d/<digital_id // 1000>.json` (ID lookup) |
| `public/lists/` | Featured lists (compact list JSON) |
| `scripts/catalog.py` | Catalog pipeline (scan, enrich, cg, names, build, update) |
| `scripts/pipeline.sh` | Full resumable catalog build |
| `data/raw/` | Append-only JSONL from the pipeline (source of truth for rebuilds) |
| `data/cg/pages.txt` | Continuity Guide pages to read when refreshing issue labels. |

## Links

- Share link: `#l=<code>`, where code is `1` + base64url(deflate-raw(JSON)). The list is entirely in the URL.
- Draft (this device): `#d=<id>`. Preview: `#p=<id>`. Featured: `#f=<name>`.
- App link per issue: `https://marvel.smart.link/fiir7ec77?type=issue&drn=<DRN>&sourceId=<SOURCE_ID>`
- **Digital IDs inside shared links must stay stable forever.**

## Data sources and credit

- Issue IDs come from Marvel's share service (`share.marvel.com/sharing/legacy/<digital_id>/raw` and `/sharing/issue/<drn>/raw`).
- Series names and years come from [Continuity Guide](https://www.continuityguide.net) and marvel.com. Continuity Guide's issue labels ("X-Men (2019) #1") anchor the series grouping; marvel.com's name for an individual issue settles disagreements, and `data/aliases.json` merges runs that sources label inconsistently. The site links back to Continuity Guide's reading orders. Their reading orders themselves aren't copied.
- Covers are hotlinked from `i.marvelfe.com` with `?w=` thumbnails, not re-hosted.

## Run locally

```
python3 -m http.server 8787 --directory public
```

## Rebuild the catalog

```
scripts/pipeline.sh          # resumable; re-run to continue
python3 scripts/catalog.py build
```
