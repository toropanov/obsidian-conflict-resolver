# Conflict Resolver

An Obsidian plugin that finds sync-conflict file copies and helps resolve them safely, change by change.

[![Obsidian Community Plugin](https://img.shields.io/badge/Obsidian-Community%20Plugin-7c3aed?logo=obsidian&logoColor=white)](https://community.obsidian.md/plugins/conflict-resolver)
[![Obsidian Community Health](https://img.shields.io/badge/Obsidian%20Community-Health%3A%20Excellent-2ea44f?logo=obsidian&logoColor=white)](https://community.obsidian.md/plugins/conflict-resolver#scorecard)
[![Obsidian Community Review](https://img.shields.io/badge/Obsidian%20Community-Review%3A%20Passed-2ea44f?logo=obsidian&logoColor=white)](https://community.obsidian.md/plugins/conflict-resolver#scorecard)
[![GitHub release](https://img.shields.io/github/v/release/toropanov/obsidian-conflict-resolver?display_name=tag&sort=semver)](https://github.com/toropanov/obsidian-conflict-resolver/releases)
[![CI](https://github.com/toropanov/obsidian-conflict-resolver/actions/workflows/ci.yml/badge.svg)](https://github.com/toropanov/obsidian-conflict-resolver/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/toropanov/obsidian-conflict-resolver)](https://github.com/toropanov/obsidian-conflict-resolver/blob/main/LICENSE)

**[Install from the Obsidian Community directory](https://community.obsidian.md/plugins/conflict-resolver)**

It is designed for vaults synchronized through Yandex Disk, iCloud Drive, Dropbox, Google Drive for desktop, Syncthing, Nextcloud, Resilio Sync, and similar tools that create conflict copies.

## Supported conflict filenames

Conflict Resolver recognises these unambiguous filename formats:

| Service or format | Conflict copy example |
| --- | --- |
| Finder, Yandex Disk, and similar clients | `Note (2).md`, `workspace (3).json` |
| Syncthing | `Note.sync-conflict-20260904-120000-DEVICEID.md` |
| Syncthing case conflict | `Note.case-conflict-timestamp-device.md` |
| Google Drive for desktop | `Budget_conf(1).xlsx` |
| Dropbox, Nextcloud, Resilio-style clients | `Plan (Alice's conflicted copy 2026-09-04).md` |
| Conservative generic format | `Plan - conflict 2026-09-04.md`, `Plan - duplicate.md` |

For every candidate, the plugin also requires a file with the original name in the same folder. It intentionally ignores ambiguous names such as `note-laptop.md`.

## Features

- Detects numbered copies: `(2)`, `(3)`, `(4)`, and so on.
- Detects common `conflict` and `conflicted copy` filename patterns.
- Adds a conflict counter to the bottom of Obsidian's File Explorer only when unresolved conflicts exist.
- Resolves one conflict file at a time.
- Shows only changed text blocks, rather than the complete file.
- Lets you choose independently for every changed block:
  - **Keep main** keeps the version from the original file.
  - **Use copy** applies the version from the conflict copy.
- Applies all selected blocks to the original and removes the resolved copy.
- Supports optional automatic cleanup of copies already contained in the original.

## Automatic cleanup

In **Settings → Community plugins → Conflict Resolver**, enable:

> Delete copies already contained in the original

When enabled, the plugin deletes a conflict copy automatically only when:

1. The copy is not empty.
2. Every non-empty line of the copy exists in the original file.
3. The copied lines occur in the same order in the original.

The original may contain additional lines between copied lines. This handles an older synced copy whose contents were later expanded in the main file, without treating unrelated repeated lines as safe to remove.

The plugin does not automatically delete a file when:

- a non-empty line from the copy is missing in the original;
- the copied line order differs;
- the copy contains unique content;
- no matching original file exists.

Those cases remain available for manual diff resolution.

## How it works

For a file named:

```text
Projects/Plan (2).md
```

the plugin looks for:

```text
Projects/Plan.md
```

If both files exist, they are treated as a conflict pair.

For differing files, Conflict Resolver calculates a local line-based diff. It groups adjacent differences into blocks and lets you choose **Keep main** or **Use copy** for every block. When you apply the selected changes, the plugin merges those choices into the original and deletes the resolved copy. No vault content is sent over the network.

## Installation

### Community plugins

1. Open **Settings → Community plugins**.
2. Turn off Restricted mode if necessary.
3. Search for **Conflict Resolver**.
4. Install and enable it.

You can also open the [Conflict Resolver listing](https://community.obsidian.md/plugins/conflict-resolver) and select **Add to Obsidian**.

### Manual installation

1. Download these files from the matching GitHub Release:

   - `main.js`
   - `manifest.json`
   - `styles.css`

2. Create this folder in your vault:

   ```text
   <vault>/.obsidian/plugins/conflict-resolver/
   ```

3. Put the three downloaded files in that folder.
4. Restart Obsidian.
5. Enable **Conflict Resolver** in Community plugins.

## Development

Requirements:

- Node.js 22 or later
- npm

```bash
git clone https://github.com/toropanov/obsidian-conflict-resolver.git
cd obsidian-conflict-resolver
npm install
npm run dev
```

To test the plugin locally, copy or symlink these files into your vault:

```text
main.js
manifest.json
styles.css
```

Target folder:

```text
<vault>/.obsidian/plugins/conflict-resolver/
```

Before opening a pull request or publishing a release:

```bash
npm run build
npm test
npm run lint
```

## Releasing

1. Update the version in `manifest.json` and `package.json`.
2. Add the version-to-minimum-Obsidian mapping in `versions.json`.
3. Run:

   ```bash
   npm run build
   npm test
   npm run lint
   ```

4. Create a GitHub Release whose tag exactly matches `manifest.json` version, for example `0.1.0`.
5. Attach these release assets:

   - `main.js`
   - `manifest.json`
   - `styles.css`

Obsidian downloads plugin files from GitHub Releases, not from the repository branch.

## Privacy and security

- No telemetry.
- No analytics.
- No network requests.
- No external services.
- All comparison and resolution happens locally in the Obsidian vault.
- Automatic deletion is opt-in.
- Any conflict that contains unique or reordered content requires manual resolution.

## Compatibility

- Minimum Obsidian version: `1.6.6`
- Desktop and mobile compatible
- Current published release: [`0.1.2`](https://github.com/toropanov/obsidian-conflict-resolver/releases/tag/0.1.2)

## License

[MIT](LICENSE)
