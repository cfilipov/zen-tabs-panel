# Svelte Migration Source Root

This root builds to the same `dist/` extension layout as `src-vanilla/`.

The popup is implemented with Svelte 5 runes and TypeScript. The chrome-scope
Experiment API, background script, shared chord engine, and options page remain
plain extension code because they run outside the Svelte popup runtime or are
intentionally kept low-touch during the migration.

Keep `src-vanilla/` available as the known-good baseline while the Svelte
variant is validated and accepted.
