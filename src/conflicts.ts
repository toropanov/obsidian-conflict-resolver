export type ConflictKind = "numbered-copy" | "cloud-conflict";

export interface ConflictName {
  canonicalName: string;
  kind: ConflictKind;
}

export function parseConflictName(name: string): ConflictName | null {
  const { stem, extension } = splitExtension(name);

  // Finder, macOS and several cloud clients: "Note (2).md".
  const numbered = stem.match(/^(.*) \(\d+\)$/u);
  if (numbered?.[1]) return conflict(numbered[1], extension, "numbered-copy");

  // Google Drive for desktop: "Report_conf(1).xlsx".
  const googleDrive = stem.match(/^(.*)_conf\(\d+\)$/iu);
  if (googleDrive?.[1]) return conflict(googleDrive[1], extension, "cloud-conflict");

  // Syncthing: "Note.sync-conflict-20260904-120000-DEVICEID.md".
  const syncthing = stem.match(/^(.*)\.sync-conflict-\d{8}-\d{6}(?:-[a-z0-9]+)?$/iu);
  if (syncthing?.[1]) return conflict(syncthing[1], extension, "cloud-conflict");

  // Syncthing on case-insensitive filesystems: "Note.case-conflict-timestamp-device.md".
  const syncthingCase = stem.match(/^(.*)\.case-conflict-[a-z0-9-]+$/iu);
  if (syncthingCase?.[1]) return conflict(syncthingCase[1], extension, "cloud-conflict");

  // Dropbox, Nextcloud and Resilio-style copies: "Note (Alice's conflicted copy 2026-09-04).md".
  const conflictedCopy = stem.match(/^(.*?) \([^)]*conflicted copy[^)]*\)$/iu);
  if (conflictedCopy?.[1]) return conflict(conflictedCopy[1], extension, "cloud-conflict");

  // A conservative generic form used by some clients: "Note - conflict 2026-09-04.md".
  const genericConflict = stem.match(/^(.*?) - (?:conflict|duplicate)(?: \d[\d -]*)?$/iu);
  if (genericConflict?.[1]) return conflict(genericConflict[1], extension, "cloud-conflict");
  return null;
}

function splitExtension(name: string): { stem: string; extension: string } {
  const index = name.lastIndexOf(".");
  return index > 0 ? { stem: name.slice(0, index), extension: name.slice(index) } : { stem: name, extension: "" };
}

function conflict(stem: string, extension: string, kind: ConflictKind): ConflictName | null {
  const canonicalName = `${stem.trim()}${extension}`;
  return stem.trim() ? { canonicalName, kind } : null;
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
