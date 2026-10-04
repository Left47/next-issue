#!/usr/bin/env python3
"""Convert data/dawn_of_x_reading_order.json into a featured list (public/lists/dawn-of-x.json).
Issues without a digital_id are looked up by DRN in the enriched catalog; if still missing they stay as copyable titles."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import catalog

ROOT = Path(__file__).resolve().parent.parent
src = json.load(open(ROOT / "data" / "dawn_of_x_reading_order.json"))
by_drn = {r["drn"]: r for r in catalog.joined().values()}
cg = {r["label"]: r["drn"] for r in catalog.read_jsonl("cg.jsonl")}

# Notes for issues with a known problem on Marvel Unlimited's side
NOTES = {
    "House of X #1": "The Marvel Unlimited app only has the Director's Cut of #1, which doesn't open. This opens the regular issue on marvel.com.",
}

# marvel.com pages that replace the app link (the list format only allows www.marvel.com)
WEB = {
    "House of X #1": "https://www.marvel.com/comics/issue/72984/house_of_x_2019_1",
}


def item(it):
    d = it.get("digital_id")
    if not d:
        # e.g. House of X #1: find its DRN via Continuity Guide's label, then its digital id
        drn = it.get("drn") or cg.get(it["title"].replace(" #", " (2019) #"))
        d = by_drn.get(drn, {}).get("digital_id")
    key = d or it["title"]
    flags = 1 if it.get("optional") else 0
    note = NOTES.get(it["title"]) or it.get("note")
    if it["title"] in WEB:
        return [key, flags, note or "", WEB[it["title"]]]
    return [key, flags, note] if note else ([key, flags] if flags else key)

out = {"t": src["title"],
       "d": "Issue-by-issue order from House of X / Powers of X through X of Swords. Based on The Gotham Archives' order, plus three optional side reads.",
       "s": [{"n": s["name"], "i": [item(i) for i in s["items"]]} for s in src["sections"]]}
json.dump(out, open(ROOT / "public" / "lists" / "dawn-of-x.json", "w"), separators=(",", ":"))
n = sum(len(s["i"]) for s in out["s"])
print(f"dawn-of-x: {n} items, {sum(1 for s in out['s'] for i in s['i'] if isinstance(i, str) or (isinstance(i, list) and isinstance(i[0], str)))} unlinked")
