# Conflict Resolver architecture

## What is a conflict

The scanner recognises a conflict copy only when its filename ends in a known sync-client suffix: Finder's ` (2)`, or a `conflict` / `conflicted copy` marker. It then looks for a sibling file with the unmodified name. A filename alone is never deleted; both files must exist.

The initial release checks text files exposed through Obsidian's vault API. It intentionally does not inspect binary data, hidden plugin internals, or remote provider metadata. That keeps the result deterministic and works with Yandex Disk, iCloud, Dropbox, OneDrive, Syncthing, and manual copies.

## Resolution policy

| Situation | Action |
| --- | --- |
| Files have byte-for-byte identical text | Delete the duplicate automatically during scanning |
| Every non-empty line of the copy is already in the original in the same order | Delete the duplicate automatically during scanning, only when enabled in settings |
| Files differ | Require a choice: keep original or use copy |
| Canonical counterpart is missing | Do not show as a conflict |
| File is already in the backup folder | Ignore it |

The optional **Delete copies already contained in the original** setting lets an automatic scan delete only a non-empty copy whose every non-empty line is already present in the original in the same order. It is off by default. Extra lines in the original are allowed, so this safely handles later insertions without accepting unrelated repeated lines. Clicking **Delete duplicate**, **Keep original**, or applying per-block choices resolves all other cases.

## UI and lifecycle

On layout readiness the plugin appends one native-looking button to each File Explorer leaf. It scans at startup and after vault create/rename events, updates the count, and exposes commands for a scan and for batch deletion of identical copies. Clicking the button opens a modal that shows only changed line blocks. Each block has an explicit choice: keep the main-file lines or use the copy lines. Applying choices writes the merged main file and deletes the copy.

## Intentional limits

Automatic three-way merges are not implemented because two files do not contain enough history to decide whether overlapping edits are safe. A future version can add Git-backed or snapshot-backed three-way merging, but it must continue to require an explicit user action before deleting a version.
