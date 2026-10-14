# Convert Local Conversation Storage

This one-time offline tool converts the retired inline Conversation JSON layout into
the current per-anchor and per-turn SQLite rows. It preserves transcript,
summary, projection, follow-up, and metadata values. It does not start Runtime,
delete conversations, or convert other owner stores.

Stop Runtime before using the tool. From the repository root, inspect the
explicit database first:

```sh
pnpm runtime:convert-chat-storage --db /absolute/path/to/memory.db --confirm-runtime-stopped
```

Apply the migration after reviewing that result:

```sh
pnpm runtime:convert-chat-storage --db /absolute/path/to/memory.db --confirm-runtime-stopped --apply
```

Passing `--apply` creates a timestamped sibling SQLite backup before performing the atomic conversion.
You can supply an explicit new backup path using `--backup`, which must point to a path that
does not already exist. If conversion fails, the original Conversation layout
remains unchanged. Re-running after a successful conversion reports that no conversion is needed.

Runtime rejects the retired inline layout and hints at this command; it never
silently converts data or maintains a secondary read path. Malformed or duplicate
historical anchors must first be repaired using the existing offline
`runtime:repair-local-agent-chat` tool, which skips the current row layout.
