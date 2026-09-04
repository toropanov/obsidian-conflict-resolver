import assert from "node:assert/strict";
import test from "node:test";
import { applyCopyHunks, createHunks, diffLines } from "./diff";

test("marks additions and removals while keeping common lines aligned", () => {
  const diff = diffLines("first\nold\nlast", "first\nnew\nlast");
  assert.deepEqual(diff.original.map((line) => [line.text, line.kind]), [["first", "same"], ["", "same"], ["old", "removed"], ["last", "same"]]);
  assert.deepEqual(diff.copy.map((line) => [line.text, line.kind]), [["first", "same"], ["new", "added"], ["", "same"], ["last", "same"]]);
});

test("applies only the selected hunks to the original", () => {
  const original = "one\ntwo\nthree\nfour";
  const copy = "ONE\ntwo\nthree\nFOUR";
  const hunks = createHunks(original, copy);
  assert.equal(applyCopyHunks(original, hunks, new Set([1])), "one\ntwo\nthree\nFOUR");
});
