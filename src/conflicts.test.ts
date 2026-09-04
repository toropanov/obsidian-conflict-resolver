import assert from "node:assert/strict";
import test from "node:test";
import { isCopyContainedInOriginal, parseConflictName } from "./conflicts";

test("recognises Finder numbered copies", () => {
  assert.deepEqual(parseConflictName("workspace (2).json"), { canonicalName: "workspace.json", kind: "numbered-copy" });
});

test("recognises Syncthing conflict copies", () => {
  assert.deepEqual(parseConflictName("Plan.sync-conflict-20260904-120000-ABCD123.md"), { canonicalName: "Plan.md", kind: "cloud-conflict" });
});

test("recognises Google Drive and conflicted-copy formats", () => {
  assert.deepEqual(parseConflictName("Budget_conf(3).xlsx"), { canonicalName: "Budget.xlsx", kind: "cloud-conflict" });
  assert.deepEqual(parseConflictName("Plan (Alice's conflicted copy 2026-09-04).md"), { canonicalName: "Plan.md", kind: "cloud-conflict" });
});

test("does not mistake an ordinary filename for a conflict", () => {
  assert.equal(parseConflictName("Q2 planning.md"), null);
});

test("recognises a copy whose non-empty lines occur in order in a changed original", () => {
  assert.equal(isCopyContainedInOriginal("first\nnew context\nsecond", "first\nsecond"), true);
  assert.equal(isCopyContainedInOriginal("first\nsecond", "second\nfirst"), false);
  assert.equal(isCopyContainedInOriginal("first\nsecond", "first\nthird"), false);
});
