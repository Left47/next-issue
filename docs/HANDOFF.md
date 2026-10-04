# Comic Reading List Site: Handoff

Original project brief. Goal: a free, no-accounts website where anyone can search Marvel comics, build an ordered reading list, and share it as a link. Every issue opens directly in the **Marvel Unlimited** app with one tap.

This came out of building a Dawn of X reading list (see `dawn-of-x-page.html`, which works on Jim's phone). It is the proof of concept for the list-viewer side.

---

## What's in this folder

| File | What it is |
|---|---|
| `HANDOFF.md` | This file |
| `dawn-of-x-page.html` | Working single-file reading list (131 issues, 129 with one-tap app links). Template for the list viewer. |
| `data/mu_catalog_scan.jsonl` | **10,599 comics** found by scanning MU digital IDs 44000–64499. One JSON object per line: `digital_id`, `source_id`, `drn`, `title`. |
| `data/scan_coverage.json` | What was scanned, how many hits, and 209 IDs that timed out (retry these). |
| `data/dawn_of_x_reading_order.json` | The Dawn of X list as structured data, with every ID and the working app link per issue. Good seed for "featured lists" and test fixtures. |
| `scripts/mu_legacy_scan.py` | The scanner. `python3 mu_legacy_scan.py START END STEP > out.json`, or `... list ID ID ...`. 16 threads. |

---

## The key discovery: how Marvel Unlimited links work

### Three IDs per issue

| ID | Example (X-Men 2019 #1) | Where it comes from | Use |
|---|---|---|---|
| **source_id** (Marvel catalog ID) | `76803` | marvel.com URLs: `marvel.com/comics/issue/76803/x-men_2019_1` | Public issue page, ties to series/issue number |
| **digital_id** (MarvelDigitalComicID) | `52818` | Old MU web reader ID; roughly ordered by digital release date, **not** by series | Key for the lookup below |
| **drn** (Unison ID) | `drn:src:marvel:unison::prod:b08e896a-8a3a-42f6-a805-104520b9a706` | Random UUID, no pattern | **Required** for the app link to open the issue |

### The working app link (verified on iPhone)

```
https://marvel.smart.link/fiir7ec77?type=issue&drn=<DRN>&sourceId=<SOURCE_ID>
```

- Without `drn`, the link does **not** open the issue (tested; it fails).
- This is the same link the "Open in Marvel Unlimited" button uses on Marvel's share pages.
- Share-page form (also works, opens a landing page first): `https://share.marvel.com/sharing/issue/<DRN>`

### The lookup that makes it possible (undocumented)

`share.marvel.com` is a server-rendered app with a route
`/sharing/:type(readingList|reader|series|issue|legacy|reading-list|character|creator)/:id/:format(raw|debug)?`

Appending `/raw` returns JSON.

- **`GET https://share.marvel.com/sharing/legacy/<digital_id>/raw`** turns a digital_id into the DRN, source_id and title. This is what the scanner uses. Look for `"UnisonPublicationContent","id":"<drn>"` and `"SourceId","value":"<n>"`.
- **`GET https://share.marvel.com/sharing/issue/<drn>/raw`** returns richer data: `publicationNumber` (the issue #), `issued` (release date), `externalIds` (TaxonomyID, MarvelDigitalComicID, SourceId), cover image URL (`i.marvelfe.com/...`) and description.
- `/sharing/issue/<source_id>` does **not** work. You need the DRN or the digital_id.
- No auth, no API key. Responses took about 0.1–0.5 s each, and 16 parallel requests were fine.

### What was ruled out

- marvel.com issue pages have no DRN in them, and marvel.com returns 403 to plain curl from cloud IPs (fetching through a browser-like client worked).
- The Marvel developer API (`gateway.marvel.com`) needs a key and doesn't expose DRNs.
- DRNs can't be calculated: X-Men #1 and #2 have unrelated UUIDs.

---

## Data gaps the build must handle

1. **Missing issue number and series year.** The legacy lookup returns the title only (e.g. "X-Men") with no issue number and no volume year, so X-Men 1963, 1991 and 2019 collide.
   - Fix: an **enrichment pass** calling `/sharing/issue/<drn>/raw` for each comic to get `publicationNumber` and `issued`.
   - Series year: take it from marvel.com series pages via `source_id` (the slug has the year, e.g. `x-men_2019_1`), or group by title plus release-date clusters. **Prototype this first.**
2. **Only part of the range is scanned.** Digital IDs 44000–64499 cover roughly 2017–2023 releases plus back-catalog additions mixed in. Full catalog: scan about 1 to ~70000+ (keep going until long runs of empty IDs). That's about 1.5–2 hours at today's rate. Retry the 209 IDs in `scan_coverage.json`.
3. **Some issues aren't found.** House of X #1 (source_id 72984) never appeared in 44000–64499. It may sit far outside the range or be missing from MU's index. The UI needs a fallback: plain title plus a "Copy title" button so people can paste it into the app's search.
4. **Fragility and terms.** These are undocumented endpoints and may change or block at any time. Keep requests polite, hotlink covers instead of re-hosting, and label the site "unofficial, not affiliated with Marvel."

---

## Planned architecture ($0)

- **Catalog build:** a Python script, run by a GitHub Action (weekly cron), scans new digital IDs above the highest one seen, enriches them, and commits JSON.
- **Data layout:** a small `series.json` index (searchable at startup) plus `series/<id>.json` per series (issues with digital_id, number, date, drn, source_id, cover) loaded on demand.
- **Frontend:** static site (Vite plus vanilla JS or Preact) with client-side search (MiniSearch) and drag-to-reorder (SortableJS). Host on Cloudflare Pages or GitHub Pages.
- **Sharing:** the list is encoded in the URL after `#`: JSON of sections plus digital IDs, compressed with deflate and base64url. Measured on Dawn of X (131 issues): **about 530–730 characters** total URL. About 4 characters per issue plus notes. **Digital IDs in shared links must stay stable forever.**
- **Optional later:** short links via a Cloudflare Worker plus KV storage, with Turnstile bot protection and a size cap. Skip a public gallery in v1 (it would need moderation). Featured lists live in the repo.

### List viewer features (already in `dawn-of-x-page.html`)
Sections, numbered issues, "optional" tags and notes, Read (app link) and Copy-title buttons, read checkmarks saved on the device, progress bar, Jump to next, Hide read.

### Editor features (to build)
Search series, add an issue or a range (#1–12), sections, drag reorder, notes, and **paste import** (lines like `Marauders (2019) #1–6` matched against the catalog).

## Suggested build phases
1. **Data prototype:** enrichment pass on the existing 10,599 records, and settle how to get series years.
2. **Full catalog:** full scan, series/issue JSON, weekly Action.
3. **Viewer:** generalize `dawn-of-x-page.html` to render any list from the URL.
4. **Editor:** search, add, reorder, sections, notes, paste import.
5. **Share and polish:** compressed links and Open Graph previews; Dawn of X as the first featured list.
6. **Launch** on Cloudflare Pages with an "unofficial" disclaimer.

Decisions so far: long links in v1 (short links later if needed); no accounts or auth.
