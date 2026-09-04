export type ConflictKind = "numbered-copy" | "cloud-conflict";

export interface ConflictName {
  canonicalName: string;
  kind: ConflictKind;
}

// Covers macOS/Finder and cloud clients: "Note (2).md", "Note - conflicted copy.md",
// and common Dropbox/OneDrive forms. Only the final filename is inspected.
const PATTERNS: readonly { pattern: RegExp; kind: ConflictKind }[] = [
  { pattern: /^(.*) \((\d+)\)(\.[^.]*)?$/u, kind: "numbered-copy" },
  { pattern: /^(.*?)(?: \(| - )(?:conflicted copy|conflict|duplicate)(?: [^)]*)?\)?(\.[^.]*)?$/iu, kind: "cloud-conflict" },
  { pattern: /^(.*?)(?: \(| - )?(?:conflicted copy|conflict)(?: [^)]*)?\)?(\.[^.]*)?$/iu, kind: "cloud-conflict" }
];

export function parseConflictName(name: string): ConflictName | null {
  for (const { pattern, kind } of PATTERNS) {
    const match = name.match(pattern);
    if (!match?.[1]) continue;
    const extension = match[3] ?? match[2] ?? "";
    return { canonicalName: `${match[1].trim()}${extension}`, kind };
  }
  return null;
}

/**
 * Returns true only when every non-whitespace copy line occurs in the original
 * in the same order. Extra lines in the original are allowed, which recognises
 * a copy that is contained between later additions without accepting a random
 * collection of repeated lines elsewhere in the file.
 */
export function isCopyContainedInOriginal(original: string, copy: string): boolean {
  if (!copy.trim()) return false;
  if (original.includes(copy)) return true;
  const originalLines = original.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const copyLines = copy.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  let searchStart = 0;
  for (const copyLine of copyLines) {
    const foundAt = originalLines.indexOf(copyLine, searchStart);
    if (foundAt < 0) return false;
    searchStart = foundAt + 1;
  }
  return copyLines.length > 0;
}
