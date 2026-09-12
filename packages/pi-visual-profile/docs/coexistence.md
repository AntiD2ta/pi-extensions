# Coexistence with Powerline

Install either package alone or both together. `pi-powerline-footer` is the only footer owner and queue owner. `pi-visual-profile` owns themes, tool cards, native chat presentation, code-fence chrome, boxed MCP presentation, and doctor output.

Each UI area has one active owner. Owner-scoped overrides elect the newest claim. Releasing a stale claim changes nothing. Releasing the active claim restores the previous owner rather than jumping to Pi's native implementation. An extension author should claim only an area it owns, keep its owner token private, and release only that token.

The profile never calls the footer override. Enabling or disabling it leaves a Powerline footer unchanged. It never writes queue data, intercepts compaction, or changes queue delivery, targeting, aliases, or retention.

`/visual-profile doctor` reports `footer: never claimed`. It also reports MCP presentation ownership when another extension has the adapter's presentation claim. Powerline reports its own footer and queue state. Install both packages when you want Powerline status and queue behavior with profile presentation above the footer.
