# Development and release guide

## Local development

1. Run `npm ci` (or `npm install` for the first lockfile).
2. Run `npm run dev` to rebuild `main.js` on changes.
3. Symlink this repository into `<vault>/.obsidian/plugins/conflict-resolver`, or copy `manifest.json`, `main.js`, and `styles.css` there.
4. In Obsidian, enable **Conflict Resolver** and use **Reload app without saving** after changing the manifest.
5. Before committing, run `npm run lint`, `npm test`, and `npm run build`.

## Versioning and release

Use semantic versions. A release must update `manifest.json`, tag `vX.Y.Z`, and attach `main.js`, `manifest.json`, and `styles.css` to a GitHub Release. Keep `main.js` out of source control: it is a reproducible build artifact. Add a `versions.json` mapping before submitting the plugin to the Obsidian community plugin directory.

## Security rules

- Do not add telemetry, network access, or dependency downloads at runtime.
- A background scan may delete only a non-empty copy whose complete text already occurs in the original; all other deletions require an explicit click.
- Treat file content as untrusted data; never execute it.
- Keep the Obsidian API dependency external in the bundle.
