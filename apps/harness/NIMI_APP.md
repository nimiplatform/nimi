# Nimi Harness

Nimi Harness is a separate desktop App for work with your Nimi local partners. It executes multi-step code, document, and local file tasks on your machine with step-by-step approval, file diff review, and pre-write snapshot recovery while Nimi Runtime coordinates your partner's memory, session routing, and model access.

## Getting Started

1. Sign in to **Nimi Home** and make sure at least one local partner has a ready cloud connector or on-device model configured in **Nimi Home → AI Capabilities**.
2. Start a task either directly from the **Nimi Home** Omni-Composer (assigning a workspace or escalating a multi-turn question) or by launching **Nimi Harness** from Nimi Home.
3. Choose **Tasks & deliverables** (default) to track deliverables, approvals, and task progress across partners, or switch to **Project workspace** to inspect directory trees, diffs, and execution transcripts.

## Key Tasks & Controls

- **Dual Fixed Views**: Switch at the top bar between **Tasks & deliverables** (focused on partner deliverables, approval cards, and snapshots) and **Project workspace** (bound folder tree, file preview, and technical execution steps), with cross-partner filtering in the sidebar.
- **Permission Modes & Approval Cards**: Choose **Strict** (asks before writes, edits, shell commands, and write integrations), **Auto-Edit** (auto-approves normal workspace file edits while still requiring one-time approval for control-plane files such as `.git/**`, `package.json`, build/test configs, scripts, and any shell command), or **Plan Only** (blocks mutations and commands).
- **Pre-Write File Recovery**: Before typed `write`, `edit`, or `delete` actions modify a workspace file, Harness saves a snapshot under Nimi's managed snapshot directory so you can restore the exact pre-edit file with one click if no external edits conflict.
- **Continuity & Compaction**: Long multi-step sessions automatically compact older context through your partner's active Runtime model route without losing verified recent steps.

## Data Handling & Security Boundaries

- **Local Workspace Execution**: File reads, writes, edits, and approved commands execute locally on your PC under your current OS user account. Harness protects workspace boundaries by blocking path escapes, symbolic/hard-link escapes, and default access to sensitive files such as `.env*`, `*.pem`, `*.key`, and `.ssh/**`.
- **Shell Commands**: Free shell commands are only available inside explicitly bound development workspaces, always require one-time approval (`allow_once`), run with a minimal environment allowlist inside a managed process group (terminating child and grandchild processes together on stop), and redact detected `.env*` secret values from output logs. Note: approved commands still execute under your desktop user account privileges.
- **Storage & Deletion**: Session transcripts, file snapshots, and temporary spill files are stored locally under your account-partitioned Nimi data directory. Deleting a session in Nimi Home or Harness removes the session's Harness transcript and Runtime index without deleting files inside a bound local project folder.

## Limitations & Help

- **Desktop Requirement**: Nimi Harness requires Nimi Home and Nimi Runtime to be running on your PC (Windows x64 or macOS arm64).
- **Shell Rollback**: File-level one-click restore applies to typed file tool mutations (`write`/`edit`/`delete`) only; arbitrary shell commands and external integrations cannot be automatically rolled back.
- **Help**: Check **Nimi Home → AI Capabilities**, **Contacts → Partners**, and **Settings** to review connected models, partner bindings, and Runtime status, or inspect the pending approval banner inside Harness when a step is waiting for your confirmation.
