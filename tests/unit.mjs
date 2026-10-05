// node tests/unit.mjs
import assert from "node:assert/strict";
import { parseLine } from "../public/js/edit.js";
import { encodeList, decodeList } from "../public/js/lib.js";

const cases = {
  "House of X (2019) #1": { title: "House of X", year: 2019, a: 1, b: 1 },
  "Powers of X (2019) #2-3": { title: "Powers of X", year: 2019, a: 2, b: 3 },
  "Marauders 2019 #1-6": { title: "Marauders", year: 2019, a: 1, b: 6 },
  "X-Men #1": { title: "X-Men", year: null, a: 1, b: 1 },
  "X-Men 2099 #1": { title: "X-Men", year: 2099, alt: "X-Men 2099", a: 1, b: 1 },
  "Uncanny X-Men (1963) #129–137": { title: "Uncanny X-Men", year: 1963, a: 129, b: 137 },
  "Wolverine (2020) #1 to #5": { title: "Wolverine", year: 2020, a: 1, b: 5 },
  "Amazing Spider-Man (2018) #16.HU": null,
  "Giant-Size X-Men: Storm (2020) #1": { title: "Giant-Size X-Men: Storm", year: 2020, a: 1, b: 1 },
  "Avengers (1963) #4.1": { title: "Avengers", year: 1963, a: 4.1, b: 4.1 },
  "Just some text": null,
  "X-Men #1 (2019)": { title: "X-Men", year: 2019, a: 1, b: 1 },
  "New Mutants #1 (2019)": { title: "New Mutants", year: 2019, a: 1, b: 1 },
  "Fallen Angels #2-6 (2019)": { title: "Fallen Angels", year: 2019, a: 2, b: 6 },
  "X-Men 2099 #1 (1993)": { title: "X-Men 2099", year: 1993, a: 1, b: 1 },
};
for (const [line, want] of Object.entries(cases)) {
  const got = parseLine(line);
  if (want === null) { assert.equal(got, null, line); continue; }
  for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, `${line} -> ${k}: ${JSON.stringify(got)}`);
}

const list = { title: "Test ✓", desc: "d", sections: [
  { name: "A", desc: "", items: [{ id: 52818, opt: false, note: "" }, { id: 52819, opt: true, note: "skim" }] },
  { name: "", desc: "x", items: [{ text: "House of X #1", opt: false, note: "" }] } ] };
const code = await encodeList(list);
assert.equal(code[0], "2");
assert.deepEqual(await decodeList(code), list);
console.log("ok", code.length, "chars for 3 items");

// spelling-insensitive keys and typo distance
import { compactKey, editDistance, typoBudget } from "../public/js/lib.js";
assert.equal(compactKey("xmen"), compactKey("X-Men"));
assert.equal(compactKey("Amazing Spiderman"), compactKey("The Amazing Spider-Man"));
assert.equal(editDistance("maruaders", "marauders", 1), 1);
assert.equal(editDistance("wolverene", "wolverine", 1), 1);
assert.equal(editDistance("hulk", "hawkeye", 1), 2);
assert.equal(typoBudget("xmen"), 0);
console.log("ok spelling");

// web links survive a share link round trip, but only for www.marvel.com
{
  const { encodeList: enc, decodeList: dec } = await import("../public/js/lib.js");
  const web = "https://www.marvel.com/comics/issue/72984/house_of_x_2019_1";
  const l = { title: "w", desc: "", sections: [{ name: "", desc: "", items: [
    { id: 52178, opt: false, note: "n", web },
    { id: 51997, opt: false, note: "", web: "https://evil.example/phish" }] }] };
  const back = await dec(await enc(l));
  assert.equal(back.sections[0].items[0].web, web);
  assert.equal(back.sections[0].items[1].web, undefined);
  console.log("ok web links");
}

// paste import: interleave series by release date, each series stays in issue order
{
  const { releaseOrder } = await import("../public/js/edit.js");
  const r = (label, date, sid) => ({ item: label, date, sid });
  const ids = (rows) => releaseOrder(rows).map((x) => x.item);
  // two series listed one after the other come out interleaved
  assert.deepEqual(ids([
    r("A1", "2003-09-01", "a"), r("A2", "2003-10-01", "a"), r("A3", "2003-11-01", "a"),
    r("B1", "2003-10-08", "b"), r("B2", "2003-11-08", "b")]), ["A1", "A2", "B1", "A3", "B2"]);
  // a later re-release date on #1 doesn't push it after #2
  assert.deepEqual(ids([r("U1", "2006-10-24", "u"), r("U2", "2000-10-04", "u"), r("X1", "2001-01-01", "x")]), ["U1", "U2", "X1"]);
  // unmatched titles stay after the issue before them; same-date ties keep pasted order
  assert.deepEqual(ids([
    r("B1", "2004-01-01", "b"), r("text after B1", null, null),
    r("A1", "2003-01-01", "a"), r("A2", "2004-01-01", "a")]), ["A1", "B1", "text after B1", "A2"]);
  console.log("ok release order");
}
