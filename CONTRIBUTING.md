# Contributing to Nimi

Thank you for your interest in contributing to Nimi! We are building an open, local-first personal AI computing platform that champions digital sovereignty, user privacy, and expressive AI interactions.

Whether you're fixing a bug, adding a new SDK capability, improving documentation, or creating an application, this guide outlines the workflow and standards for contributing.

---

## 1. Development Prerequisites

Ensure your development workstation meets these minimum requirements:

- **Node.js**: `>= 24.0.0`
- **pnpm**: `>= 10.0.0`
- **Go**: Required for Runtime and gRPC service development (see `runtime/go.mod`)
- **Rust**: Required for Kit native addons and Tauri carrier crates
- **Buf CLI**: Required if modifying Protocol Buffer schemas under `proto/`

---

## 2. Workspace Setup

Clone the repository and install all dependencies:

```bash
# Clone the repository
git clone https://github.com/nimiplatform/nimi.git
cd nimi

# Install workspace dependencies
pnpm install

# Build core packages (SDK, Kit, web)
pnpm build
```

### Starting Local Services
- **Runtime**: `pnpm dev:runtime` (starts the local Go-based AI execution daemon)
- **Desktop Host**: `pnpm dev:desktop` (starts the Electron development shell)
- **Website**: `pnpm --filter @nimiplatform/web dev`
- **Documentation**: `pnpm docs:dev`

For a step-by-step first-time walkthrough, consult [ONBOARDING.md](./ONBOARDING.md) and [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md).

---

## 3. Contribution Workflow

1. **Focused PRs**: Keep pull requests focused on a single logical objective. Avoid mixing unrelated refactors with functional changes.
2. **Local Verification**: Before opening a PR, run the relevant package checks (e.g. `pnpm --filter <pkg> run check && pnpm --filter <pkg> test`).
3. **Documentation Parity**: Whenever user-visible features or public SDK APIs change, update the corresponding markdown documentation in `docs/` or package READMEs.
4. **Clean Commits**: Write concise, descriptive commit messages.
5. **DCO**: Commit sign-off and cryptographic signatures are currently suspended for `main` (including PRs targeting `main`). PRs targeting any other branch must still include the `Signed-off-by` trailer via `git commit -s`; see [DCO](DCO).

---

## 4. Architectural Boundaries to Respect

To maintain security and architectural integrity, adhere strictly to these isolation rules:
- **Renderer Isolation**: Web and Desktop renderers must never directly import `runtime/internal/**` or open unverified gRPC sockets. Nimi Apps make protected calls through the host-injected SDK client, while the website uses its own dedicated contracts for browser authentication and public network requests.
- **Fail-Closed Permissions**: App operations require the current protected session and the declared access that Runtime admits; an App cannot grant itself access.
- **Single Source of Truth**: Protocol Buffers (`proto/`) and canonical specifications (`.nimi/spec/**`) govern cross-language interfaces. Never edit generated files by hand.

---

## 5. Testing & CI

CI runs the checks matching the workflows triggered by your changes. Because platform coverage varies by component, inspect `.github/workflows/` and the check results on your PR.

For the complete testing matrix and debugging tips, see [TESTING.md](./TESTING.md).

---

## 6. Security Vulnerabilities

Please do not report security vulnerabilities through public GitHub issues. Follow the responsible disclosure guidelines in [SECURITY.md](./SECURITY.md).
