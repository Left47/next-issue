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
