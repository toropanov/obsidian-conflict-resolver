import assert from "node:assert/strict";
import test from "node:test";
import { applyCopyHunks, applyHunkResolutions, createHunks, diffLines } from "./diff";
import { shouldShowConflictButton } from "./ui";

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

test("builds the preview from original, copy, and both choices", () => {
  const original = "one\ntwo\nthree\nfour";
  const copy = "ONE\ntwo\nthree\nFOUR";
  const hunks = createHunks(original, copy);
  assert.equal(
    applyHunkResolutions(original, hunks, new Map([[0, "both"], [1, "copy"]])),
    "one\nONE\ntwo\nthree\nFOUR"
  );
});

test("inserts after a shared blank line instead of before it", () => {
  const original = "title\n\nparagraph\nfooter";
  const copy = "title\n\ninserted\nparagraph\nfooter";
  const hunks = createHunks(original, copy);

  assert.deepEqual(hunks, [{ originalStart: 2, originalLines: [], copyLines: ["inserted"] }]);
  assert.equal(applyCopyHunks(original, hunks, new Set([0])), copy);
});

test("keeps later replacements aligned when the unchanged prefix has blank lines", () => {
  const original = "# Note\n\nintro\n\nold value\nclosing";
  const copy = "# Note\n\nintro\n\nnew value\nclosing";
  const hunks = createHunks(original, copy);

  assert.deepEqual(hunks, [{ originalStart: 4, originalLines: ["old value"], copyLines: ["new value"] }]);
  assert.equal(applyCopyHunks(original, hunks, new Set([0])), copy);
});

test("shows the file-explorer resolver button only when conflicts exist", () => {
  assert.equal(shouldShowConflictButton(0), false);
  assert.equal(shouldShowConflictButton(1), true);
});
