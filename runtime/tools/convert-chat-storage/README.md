# Convert local Conversation storage

This one-time offline tool converts the retired inline Conversation JSON into
the current per-anchor and per-turn SQLite rows. It preserves transcript,
summary, projection, follow-up, and metadata values. It does not start Runtime,
delete conversations, or convert other owner stores.

Stop Runtime before using the tool. From the repository root, inspect the
explicit database first:

```sh
pnpm runtime:convert-chat-storage --db /absolute/path/to/memory.db --confirm-runtime-stopped
```

Apply after reviewing that result:

```sh
pnpm runtime:convert-chat-storage --db /absolute/path/to/memory.db --confirm-runtime-stopped --apply
```

Apply creates a timestamped sibling SQLite backup before the atomic conversion.
An explicit new backup path can be supplied with `--backup`. The backup must not
already exist. A failed conversion leaves the original Conversation layout
unchanged. Re-running after success reports that no conversion is needed.

Runtime rejects the retired inline layout with this command hint; it never
silently converts or maintains a second read path. Malformed or duplicate
historical anchors must first be handled by the existing offline
`runtime:repair-local-agent-chat` tool. That tool skips the current row layout.
