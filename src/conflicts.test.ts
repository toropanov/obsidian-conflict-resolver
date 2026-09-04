import assert from "node:assert/strict";
import test from "node:test";
import { isCopyContainedInOriginal, parseConflictName } from "./conflicts";

test("recognises Finder numbered copies", () => {
  assert.deepEqual(parseConflictName("workspace (2).json"), { canonicalName: "workspace.json", kind: "numbered-copy" });
});

test("does not mistake an ordinary filename for a conflict", () => {
  assert.equal(parseConflictName("Q2 planning.md"), null);
});

test("recognises a copy whose non-empty lines occur in order in a changed original", () => {
  assert.equal(isCopyContainedInOriginal("first\nnew context\nsecond", "first\nsecond"), true);
  assert.equal(isCopyContainedInOriginal("first\nsecond", "second\nfirst"), false);
  assert.equal(isCopyContainedInOriginal("first\nsecond", "first\nthird"), false);
});
