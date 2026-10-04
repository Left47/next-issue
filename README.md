# Next Issue

A free, no-accounts website for building comic reading lists and sharing them as links. Every issue opens straight in the **Marvel Unlimited** app with one tap.

Unofficial. Not affiliated with Marvel. Readers need their own Marvel Unlimited subscription; this only makes the subscription easier to use. If Marvel adds shareable reading lists to the app, this site should retire.

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
| `data/cg/` | Saved Continuity Guide pages (series names, years, issue links) |

## Links

- Share link: `#l=<code>`, where code is `1` + base64url(deflate-raw(JSON)). The list is entirely in the URL.
- Draft (this device): `#d=<id>`. Preview: `#p=<id>`. Featured: `#f=<name>`.
- App link per issue: `https://marvel.smart.link/fiir7ec77?type=issue&drn=<DRN>&sourceId=<SOURCE_ID>`
- **Digital IDs inside shared links must stay stable forever.**

## Data sources and credit

- Issue IDs come from Marvel's share service (`share.marvel.com/sharing/legacy/<digital_id>/raw` and `/sharing/issue/<drn>/raw`). These are undocumented; keep requests slow (`RATE`, default 8/s).
- Series names and years come first from [Continuity Guide](https://www.continuityguide.net), whose issue labels ("X-Men (2019) #1") anchor the series grouping. The site links back to their reading orders. Their reading orders themselves aren't copied.
- Series not covered by Continuity Guide get their name from the marvel.com issue page (one request per series, 2/s).
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
