export type DiffKind = "same" | "removed" | "added";

export interface DiffLine {
  text: string;
  kind: DiffKind;
}

export interface LineDiff {
  original: DiffLine[];
  copy: DiffLine[];
}

export interface DiffHunk {
  /** Zero-based insertion point in the original file. */
  originalStart: number;
  originalLines: string[];
  copyLines: string[];
}

/**
 * Produces a readable line diff using the longest-common-subsequence matrix.
 * It is deliberately local and dependency-free: vault text is never sent away.
 */
export function diffLines(originalText: string, copyText: string): LineDiff {
  const left = originalText.split("\n");
  const right = copyText.split("\n");
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));

  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      matrix[i]![j] = left[i] === right[j]
        ? matrix[i + 1]![j + 1]! + 1
        : Math.max(matrix[i + 1]![j]!, matrix[i]![j + 1]!);
    }
  }

  const original: DiffLine[] = [];
  const copy: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      original.push({ text: left[i]!, kind: "same" });
      copy.push({ text: right[j]!, kind: "same" });
      i++; j++;
    } else if (j < right.length && (i === left.length || matrix[i]![j + 1]! >= matrix[i + 1]![j]!)) {
      original.push({ text: "", kind: "same" });
      copy.push({ text: right[j]!, kind: "added" });
      j++;
    } else {
      original.push({ text: left[i]!, kind: "removed" });
      copy.push({ text: "", kind: "same" });
      i++;
    }
  }
  return { original, copy };
}

/** Groups adjacent changed rows into the smallest useful units for a resolver UI. */
export function createHunks(originalText: string, copyText: string): DiffHunk[] {
  const diff = diffLines(originalText, copyText);
  const hunks: DiffHunk[] = [];
  let originalLine = 0;
  let active: DiffHunk | null = null;

  for (let row = 0; row < diff.original.length; row++) {
    const left = diff.original[row]!;
    const right = diff.copy[row]!;
    const changed = left.kind !== "same" || right.kind !== "same";
    if (!changed) {
      active = null;
      if (left.text) originalLine++;
      continue;
    }
    if (!active) {
      active = { originalStart: originalLine, originalLines: [], copyLines: [] };
      hunks.push(active);
    }
    if (left.kind === "removed") {
      active.originalLines.push(left.text);
      originalLine++;
    }
    if (right.kind === "added") active.copyLines.push(right.text);
  }
  return hunks;
}

export function applyCopyHunks(originalText: string, hunks: DiffHunk[], useCopy: ReadonlySet<number>): string {
  const lines = originalText.split("\n");
  // Apply bottom-up so replacements above do not invalidate lower offsets.
  for (let index = hunks.length - 1; index >= 0; index--) {
    if (!useCopy.has(index)) continue;
    const hunk = hunks[index]!;
    lines.splice(hunk.originalStart, hunk.originalLines.length, ...hunk.copyLines);
  }
  return lines.join("\n");
}
