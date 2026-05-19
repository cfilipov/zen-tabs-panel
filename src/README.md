# Extension Source Root

This root builds to the `dist/` extension layout.

The popup is implemented with Svelte 5 runes and TypeScript. The chrome-scope
Experiment API, background script, shared chord engine, and options page remain
plain extension code because they run outside the Svelte popup runtime.
