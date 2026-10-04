#!/usr/bin/env python3
"""Marvel Unlimited catalog pipeline.

  catalog.py scan START END      legacy lookup digital IDs [START, END) -> data/raw/legacy.jsonl
  catalog.py retry               re-try IDs that errored during scan
  catalog.py enrich              issue details (number, date, cover) for every DRN -> data/raw/issues.jsonl
  catalog.py cg                  parse saved Continuity Guide pages (data/cg/*.html) -> data/raw/cg.jsonl
  catalog.py names               canonical series names from marvel.com, one fetch per cluster -> data/raw/names.jsonl
  catalog.py build               write site data into public/data/
  catalog.py update              weekly job: scan past the highest ID seen, enrich, name, build

All raw files are append-only JSONL so any step can be interrupted and resumed.
Endpoints are undocumented; keep concurrency low and requests polite.
"""
import concurrent.futures as cf, html, json, os, re, ssl, sys, threading, time, urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "data"
RAW.mkdir(parents=True, exist_ok=True)

THREADS = int(os.environ.get("THREADS", "6"))
RATE = float(os.environ.get("RATE", "8"))  # max requests/second across all threads
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
ca = os.environ.get("SSL_CERT_FILE")
ctx = ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()
opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
DRN_PREFIX = "drn:src:marvel:unison::prod:"


_lock, _next = threading.Lock(), [0.0]


def throttle():
    with _lock:
        now = time.time()
        wait = _next[0] - now
        _next[0] = max(now, _next[0]) + 1.0 / RATE
    if wait > 0:
        time.sleep(wait)


def fetch(url, timeout=25):
    throttle()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return opener.open(req, timeout=timeout).read().decode("utf8", "ignore")


def read_jsonl(name):
    p = RAW / name
    if not p.exists():
        return []
    out = []
    with open(p) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass  # half-written last line from an interrupted run
    return out


def run_pool(fn, items, outfile, label):
    """Map fn over items with a thread pool, appending each non-None result to outfile."""
    items = list(items)
    t0, done = time.time(), 0
    with open(RAW / outfile, "a") as f, cf.ThreadPoolExecutor(THREADS) as ex:
        for res in ex.map(fn, items):
            done += 1
            if res is not None:
                f.write(json.dumps(res) + "\n")
            if done % 500 == 0:
                f.flush()
                rate = done / (time.time() - t0)
                print(f"{label}: {done}/{len(items)}  {rate:.1f}/s", file=sys.stderr, flush=True)
    print(f"{label}: finished {done} in {time.time()-t0:.0f}s", file=sys.stderr)


# ---------- scan: digital_id -> drn, source_id, title ----------

def legacy(d):
    try:
        t = fetch(f"https://share.marvel.com/sharing/legacy/{d}/raw")
    except Exception:
        return {"digital_id": d, "error": True}
    drn = re.search(r'"UnisonPublicationContent","id":"(' + re.escape(DRN_PREFIX) + r'[0-9a-f-]{36})"', t)
    if not drn:
        return {"digital_id": d, "missing": True}
    src = re.search(r'"SourceId","value":"(\d+)"', t)
    title = re.search(r'"UnisonPublicationContent","id":"[^"]+","title":"((?:[^"\\]|\\.)*)"', t)
    return {"digital_id": d, "source_id": int(src.group(1)) if src else None,
            "drn": drn.group(1), "title": json.loads(f'"{title.group(1)}"') if title else None}


def scan_ids(ids, force=False):
    st = legacy_state()
    ids = [d for d in ids if force or d not in st or st[d].get("error")]
    run_pool(legacy, ids, "legacy.jsonl", "scan")


def legacy_state():
    """Latest result per digital_id (later lines win)."""
    state = {}
    for r in read_jsonl("legacy.jsonl"):
        state[r["digital_id"]] = r
    return state


def found_records():
    return {d: r for d, r in legacy_state().items() if r.get("drn")}


# ---------- enrich: drn -> issue number, date, cover ----------

def issue(rec):
    drn = rec["drn"]
    try:
        t = fetch(f"https://share.marvel.com/sharing/issue/{drn}/raw")
        j = json.loads(t)
        c = j["data"]["appProfileForDevice"]["sections"][0]["pageByPath"]["templateContent"]
    except Exception:
        return None
    cover = None
    for th in c.get("thumbnails") or []:
        for cr in ((th.get("contentOrError") or {}).get("entity") or {}).get("crops") or []:
            cover = cover or cr.get("url")
    ext = {e["key"]: e["value"] for e in c.get("externalIds") or []}
    dig = ext.get("MarvelDigitalComicID")
    return {"drn": drn, "digital_id": int(dig) if dig and dig.isdigit() else None, "num": c.get("publicationNumber"), "issued": c.get("issued"),
            "title": c.get("title"), "edition": c.get("edition"),
            "cover": cover, "source_id": int(ext["SourceId"]) if ext.get("SourceId") else None,
            "premium": ((c.get("contentPackage") or {}).get("isPremium"))}


def enrich():
    have = {r["drn"] for r in read_jsonl("issues.jsonl")}
    todo = [r for r in found_records().values() if r["drn"] not in have]
    seen = {r["drn"] for r in todo} | have
    todo += [{"drn": d} for d in cg_names() if d not in seen]
    print(f"enrich: {len(todo)} to fetch ({len(have)} already done)", file=sys.stderr)
    run_pool(issue, todo, "issues.jsonl", "enrich")


# ---------- clustering into series ----------

def joined():
    """digital_id -> merged record with issue details."""
    det = {r["drn"]: r for r in read_jsonl("issues.jsonl")}
    out = {}
    for d, r in found_records().items():
        e = det.get(r["drn"], {})
        out[d] = {**r, "num": e.get("num"), "issued": e.get("issued"), "cover": e.get("cover"),
                  "source_id": r.get("source_id") or e.get("source_id"),
                  "title": r.get("title") or e.get("title") or "Untitled"}
    known = {r["drn"] for r in out.values()}
    for drn, e in det.items():
        d = e.get("digital_id")
        if drn not in known and d and d not in out:
            out[d] = {"digital_id": d, "drn": drn, "source_id": e.get("source_id"), "title": e.get("title") or "Untitled",
                      "num": e.get("num"), "issued": e.get("issued"), "cover": e.get("cover")}
    return out


def year_of(iso):
    return int(iso[:4]) if iso else None


def cluster(recs):
    """Group records with the same title into volumes.

    Within a title, sort by release date; a new volume starts when the issue number
    goes backwards (or repeats) or there's a long gap with a low issue number.
    Returns list of dicts: {title, recs:[...]}.
    """
    by_title = defaultdict(list)
    for r in recs.values():
        by_title[r["title"]].append(r)
    vols = []
    for title, rs in by_title.items():
        dated = sorted([r for r in rs if r["issued"]], key=lambda r: (r["issued"], r["num"] or 0))
        undated = [r for r in rs if not r["issued"]]
        cur, last_num, last_date = [], None, None
        for r in dated:
            n, dt = r["num"], r["issued"]
            gap_years = (year_of(dt) - year_of(last_date)) if last_date else 0
            new = False
            if cur and n is not None and last_num is not None:
                if n == 1 and last_num >= 1 and float(n) <= float(last_num):
                    new = True
                elif gap_years >= 3 and n <= 2:
                    new = True
            if new:
                vols.append({"title": title, "recs": cur})
                cur = []
            cur.append(r)
            if n is not None and (last_num is None or n >= last_num or n == 1):
                last_num = n
            last_date = dt
        if cur:
            vols.append({"title": title, "recs": cur})
        if undated:
            vols.append({"title": title, "recs": undated})
    return vols


# ---------- Continuity Guide: series names + years (credit: continuityguide.net) ----------

CG_LABEL = re.compile(r"^(.*?)\s*\((\d{4})\)\s*#\s*(\S+?)(?:\s*-\s*(\S+))?$")


def cg_parse():
    rows = []
    pages = sorted((ROOT / "data" / "cg").glob("[a-z]*.html"))
    if not pages:
        print("cg: no saved pages in data/cg; keeping existing cg.jsonl", file=sys.stderr)
        return
    for f in pages:
        t = f.read_text()
        for m in re.finditer(r'<a href="https://share\.marvel\.com/sharing/issue/(' + re.escape(DRN_PREFIX) + r'[0-9a-f-]{36})"[^>]*>(.*?)</a>', t, re.S):
            label = html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).replace("\xa0", " ")
            label = re.sub(r"\s+", " ", label).strip().replace("\u2019", "'")
            lm = CG_LABEL.match(label)
            rows.append({"drn": m.group(1), "page": f.stem, "label": label,
                         "series": lm and lm.group(1), "year": lm and int(lm.group(2)),
                         "first": lm and lm.group(3), "last": lm and (lm.group(4) or lm.group(3))})
    with open(RAW / "cg.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    print(f"cg: {len(rows)} links, {sum(1 for r in rows if r['series'])} with a series name+year", file=sys.stderr)


def cg_names():
    """drn -> {series, year, pages}"""
    out = {}
    for r in read_jsonl("cg.jsonl"):
        if not r.get("series"):
            continue
        o = out.setdefault(r["drn"], {"series": r["series"], "year": r["year"], "pages": []})
        if r["page"] not in o["pages"]:
            o["pages"].append(r["page"])
    return out


# ---------- names: canonical "Title (Year)" from marvel.com ----------

def marvel_name(source_id):
    try:
        t = fetch(f"https://www.marvel.com/comics/issue/{source_id}", timeout=30)
    except Exception as e:
        code = getattr(e, "code", None)
        return {"source_id": source_id, "error": code or str(e)[:80]}
    m = re.search(r'og:title" content="([^"|]+?)\s*\|', t)
    name = m.group(1).strip() if m else None
    s = re.search(r'/comics/series/(\d+)/([a-z0-9_]+)', t)
    return {"source_id": source_id, "name": name,
            "series_id": int(s.group(1)) if s else None, "series_slug": s.group(2) if s else None}


def names():
    have = {r["source_id"] for r in read_jsonl("names.jsonl") if not r.get("error")}
    vols = cluster(joined())
    cgn = cg_names()
    todo = []
    for v in vols:
        if any(r["drn"] in cgn for r in v["recs"]):
            continue
        # one representative per volume: the earliest issue that has a source_id
        rep = next((r["source_id"] for r in sorted(v["recs"], key=lambda r: (r["num"] is None, r["num"] or 0))
                    if r.get("source_id")), None)
        if rep and rep not in have:
            todo.append(rep)
    print(f"names: {len(todo)} volumes to look up", file=sys.stderr)
    global THREADS
    global RATE
    THREADS, RATE = min(THREADS, 4), min(RATE, 2)  # marvel.com is a real website; go gently
    run_pool(marvel_name, todo, "names.jsonl", "names")

    # then check individual issues that look misplaced, until nothing new turns up
    recs = joined()
    for _ in range(3):
        nm = marvel_names()
        series = assemble(recs, nm, cgn)
        todo = sorted((duplicate_suspects(series, cgn, nm) | early_suspects(series, cgn, nm)) - have)
        print(f"names: {len(todo)} misplaced-looking issues to look up", file=sys.stderr)
        if not todo:
            break
        run_pool(marvel_name, todo, "names.jsonl", "names")
        have |= set(todo)


def early_suspects(series, cgn, nm):
    """source_ids of unconfirmed issues released well before the first Continuity Guide-confirmed
    issue of their series (e.g. a reprint of an old #1 sitting in a new volume)."""
    out = set()
    for s in series.values():
        anchored = [r["issued"] for r in s["recs"] if r["drn"] in cgn and r["issued"]]
        if not anchored:
            continue
        start = _days(min(anchored)) - 62
        for r in s["recs"]:
            if r["drn"] not in cgn and r["issued"] and _days(r["issued"]) < start and r.get("source_id") and r["source_id"] not in nm:
                out.add(r["source_id"])
    return out


NAME_RE = re.compile(r"^(.*?)\s*\((\d{4})\)\s*(?:#(\S+))?\s*$")


def parse_name(name):
    """'X-Men (2019) #1' -> ('X-Men', 2019)."""
    if not name:
        return None, None
    m = NAME_RE.match(name)
    if m:
        return m.group(1), int(m.group(2))
    return re.sub(r"\s*#\S+$", "", name), None


def split_by_cg(rs, cgn):
    """Name a heuristic volume using Continuity Guide labels as anchors.

    Yields (series, year, records, cg_pages). If CG labels inside one volume disagree
    (e.g. the heuristic merged X-Men 1991 and X-Men 2019), each unlabeled record joins
    the labeled record nearest to it by release date. With no labels, yields (None, None, rs, []).
    """
    anchors = [(r, (cgn[r["drn"]]["series"], cgn[r["drn"]]["year"])) for r in rs if r["drn"] in cgn]
    if not anchors:
        yield None, None, rs, []
        return
    labels = {lab for _, lab in anchors}
    groups = defaultdict(list)
    if len(labels) == 1:
        groups[next(iter(labels))] = list(rs)
    else:
        dated = sorted((r["issued"], lab) for r, lab in anchors if r["issued"])
        for r in rs:
            if r["drn"] in cgn:
                groups[(cgn[r["drn"]]["series"], cgn[r["drn"]]["year"])].append(r)
            elif r["issued"] and dated:
                near = min(dated, key=lambda a: abs(_days(a[0]) - _days(r["issued"])))
                groups[near[1]].append(r)
            else:
                groups[anchors[0][1]].append(r)
    for (base, year), part in groups.items():
        pages = sorted({p for r in part if r["drn"] in cgn for p in cgn[r["drn"]]["pages"]})
        yield base, year, part, pages


def _days(iso):
    y, m, d = int(iso[:4]), int(iso[5:7] or 1), int(iso[8:10] or 1)
    return y * 372 + m * 31 + d


# ---------- build: site data ----------

def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def fmt_num(n):
    if n is None:
        return None
    f = float(n)
    return str(int(f)) if f.is_integer() else str(f)


def marvel_names():
    return {r["source_id"]: r for r in read_jsonl("names.jsonl") if not r.get("error") and r.get("name")}


def assemble(recs, nm, cgn):
    """Group records into named series: {key: {title, year, mseries, recs, cg}}.

    Naming priority per issue: Continuity Guide label > marvel.com name for that issue >
    the heuristic volume's name (from a representative issue, or its earliest year).
    """
    series = {}

    def add(base, year, rs, pages, mseries=None):
        if not rs:
            return
        key = f"{base.lower()}|{year}"
        s = series.setdefault(key, {"title": base, "year": year, "mseries": mseries, "recs": [], "cg": set()})
        s["recs"].extend(rs)
        s["cg"].update(pages)

    for v in cluster(recs):
        rs = v["recs"]
        name_rec = None
        for r in sorted(rs, key=lambda r: (r["num"] is None, r["num"] or 0)):
            if r.get("source_id") in nm:
                name_rec = nm[r["source_id"]]
                break
        for base, year, part, pages in split_by_cg(rs, cgn):
            if not base:
                base, year = parse_name(name_rec and name_rec["name"])
            if not base:
                base = v["title"]
            if not year:
                ys = [year_of(r["issued"]) for r in part if r["issued"]]
                year = min(ys) if ys else None
            # issues marvel.com names individually (and CG doesn't) go where marvel.com says,
            # e.g. a 2019 digital re-release of X-Men (1963) #1 that clustered with X-Men (2019)
            keep = []
            for r in part:
                own = nm.get(r.get("source_id"))
                ob, oy = parse_name(own and own["name"])
                if r["drn"] not in cgn and ob and oy and (ob.lower(), oy) != (base.lower(), year):
                    add(ob, oy, [r], [], own.get("series_id"))
                else:
                    keep.append(r)
            add(base, year, keep, pages, name_rec and name_rec.get("series_id"))
    return series


def duplicate_suspects(series, cgn, nm):
    """source_ids of unconfirmed issues that share an issue number with another issue in the same series."""
    out = set()
    for s in series.values():
        by = defaultdict(list)
        for r in s["recs"]:
            if r["num"] is not None:
                by[float(r["num"])].append(r)
        for rs in by.values():
            if len(rs) > 1:
                for r in rs:
                    if r["drn"] not in cgn and r.get("source_id") and r["source_id"] not in nm:
                        out.add(r["source_id"])
    return out


def build():
    # only issues with details (number, date, cover); newly scanned ones join after the enrich step
    enriched = {r["drn"] for r in read_jsonl("issues.jsonl")}
    recs = {d: r for d, r in joined().items() if r["drn"] in enriched}
    nm = marvel_names()
    cgn = cg_names()
    series = assemble(recs, nm, cgn)

    # stable-ish ids: slug of title + year, disambiguated
    used = set()
    out_series = []
    for key, s in sorted(series.items(), key=lambda kv: (kv[1]["title"].lower(), kv[1]["year"] or 0)):
        sid = slugify(f"{s['title']} {s['year'] or ''}") or "series"
        base_sid, i = sid, 2
        while sid in used:
            sid, i = f"{base_sid}-{i}", i + 1
        used.add(sid)
        issues = sorted(s["recs"], key=lambda r: (r["num"] is None, float(r["num"]) if r["num"] is not None else 0, r["issued"] or ""))
        out_series.append((sid, s, issues))

    (OUT / "s").mkdir(parents=True, exist_ok=True)
    (OUT / "d").mkdir(parents=True, exist_ok=True)
    for p in list((OUT / "s").glob("*.json")) + list((OUT / "d").glob("*.json")):
        p.unlink()

    index, shards = [], defaultdict(dict)
    for sid, s, issues in out_series:
        rows = []
        for r in issues:
            # compact issue row: [digital_id, number, date, drn-uuid, source_id, cover-path]
            cover = r.get("cover") or ""
            cover = cover.replace("https://i.marvelfe.com/m/", "")
            row = [r["digital_id"], fmt_num(r["num"]), (r["issued"] or "")[:10],
                   r["drn"].replace(DRN_PREFIX, ""), r.get("source_id"), cover]
            rows.append(row)
            # shard row: [series_id, title, year, number, date, drn-uuid, source_id, cover]
            shards[r["digital_id"] // 1000][r["digital_id"]] = [sid, s["title"], s["year"]] + row[1:]
        nums = [x[1] for x in rows if x[1] is not None]
        dates = [x[2] for x in rows if x[2]]
        index.append({"id": sid, "t": s["title"], "y": s["year"], "n": len(rows),
                      "r": [nums[0], nums[-1]] if nums else None,
                      "d": [min(dates)[:4], max(dates)[:4]] if dates else None,
                      "c": rows[0][5] if rows else "", **({"g": 1} if s["cg"] else {})})
        with open(OUT / "s" / f"{sid}.json", "w") as f:
            json.dump({"id": sid, "t": s["title"], "y": s["year"], "ms": s["mseries"], "cg": sorted(s["cg"]), "i": rows}, f, separators=(",", ":"))
    for k, m in shards.items():
        with open(OUT / "d" / f"{k}.json", "w") as f:
            json.dump(m, f, separators=(",", ":"))
    with open(OUT / "series.json", "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"build: {len(index)} series, {sum(x['n'] for x in index)} issues, {len(shards)} id shards", file=sys.stderr)


def update():
    state = legacy_state()
    top = max(state) if state else 44000
    # scan past the highest seen ID; stop once a long empty run appears
    start = top + 1
    while True:
        ids = list(range(start, start + 1000))
        scan_ids(ids)
        st = legacy_state()
        hits = [i for i in ids if st.get(i, {}).get("drn")]
        print(f"update: {start}-{start+999}: {len(hits)} hits", file=sys.stderr)
        if not hits:
            break
        start += 1000
    enrich()
    names()
    build()


def import_handoff():
    """Seed legacy.jsonl from the original handoff scan."""
    p = ROOT / "data" / "mu_catalog_scan.jsonl"
    cov = json.load(open(ROOT / "data" / "scan_coverage.json"))
    have = set(legacy_state())
    found = set()
    with open(RAW / "legacy.jsonl", "a") as f:
        for line in open(p):
            r = json.loads(line)
            found.add(r["digital_id"])
            if r["digital_id"] not in have:
                f.write(json.dumps({"digital_id": r["digital_id"], "source_id": r["source_id"], "drn": r["drn"], "title": r["title"]}) + "\n")
        errs = set(cov.get("unresolved_request_errors", []))
        for a, b in cov["ranges_scanned"]:
            for d in range(a, b + 1):
                if d not in found and d not in have:
                    f.write(json.dumps({"digital_id": d, **({"error": True} if d in errs else {"missing": True})}) + "\n")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
    if cmd == "scan":
        scan_ids(range(int(sys.argv[2]), int(sys.argv[3])))
    elif cmd == "retry":
        errs = [d for d, r in legacy_state().items() if r.get("error")]
        print(f"retry: {len(errs)} ids", file=sys.stderr)
        scan_ids(errs)
    elif cmd == "enrich":
        enrich()
    elif cmd == "cg":
        cg_parse()
    elif cmd == "names":
        names()
    elif cmd == "build":
        build()
    elif cmd == "update":
        update()
    elif cmd == "import":
        import_handoff()
    else:
        print(__doc__)
