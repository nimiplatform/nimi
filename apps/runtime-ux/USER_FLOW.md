# Runtime Settings — UX Redesign Proposal (v2, intent-driven)

> **Status: UX proposal prototype.** This package is a self-contained Storybook design study. It
> changes no production code. Desktop's information architecture is contract-fixed by
> `.nimi/spec/desktop/product-surfaces.authority.yaml`
> (`rule.nimi.desktop.product-surfaces.r023`), so implementing this design in production requires
> prior `.nimi/spec/**` alignment.

## Problem statement

The current Desktop Runtime panel has a 7-entry sidebar, and several entries hide a second level
of `PillTabs`:

- **Overview** — dashboard
- **Profiles** — 4 subtabs: Recommended / My Profiles / From current model setup / Author manually
- **Loadouts** — dynamic per-capability subtabs (chat/image/…), current plan vs recommended plans
- **Model Market** — discover/install cloud-agnostic model catalog
- **Local Assets** — installed local models, downloads, imports
- **Cloud Connectors** — provider API keys/OAuth, test
- **Environment** — 5 subtabs: Local AI, Health, Activity, Access (external-agent tokens), Data & Storage

First-round problems (still valid):

1. **Concept overlap.** "Model Market", "Local Assets", and "Loadouts" all talk about models.
   Users install a model and expect it to answer — but installation and selection live in
   different places ("install ≠ select" confusion).
2. **Flows masquerading as tabs.** Profiles exposes its creation paths as peer tabs, so a
   one-time wizard flow permanently occupies top-level navigation.
3. **Unclear journey.** Nested tabs give no answer to "what do I do next?".

Second-round insight (why v1 of this redesign wasn't enough):

4. **The v1 revision renamed containers but kept system objects in navigation.** "Connectors",
   "Models", and "Loadouts" are architecture nouns — they describe how the runtime is built, not
   what the user wants. Users don't think in connectors and loadouts; they think in **intents**
   (quality, cost, privacy) and **questions** ("is it working?", "who answered this?", "how much
   did I spend?"). Three sidebar entries about models is still three entries about models, even
   after merging the pages.

## Design principles

1. **Navigate by intent, not by system object.** Primary entries are user questions. Architecture
   nouns (connector, loadout) never appear in primary navigation — they exist only as sections
   inside the page that owns their intent.
2. **Simple mode gives intent, advanced mode gives control.** Presets handle the 90% case as one
   decision. The underlying engineering objects remain reachable as collapsed
   progressive-disclosure sections for power users.
3. **One concept, one home.** Every user-facing concept lives behind exactly one sidebar entry.
4. **Flatten navigation — segmentation is a filter, not a flow.** Second-level controls narrow one
   page's content; they never represent sequential steps of a task.
5. **Flows become wizards.** Multi-step tasks (first-run setup, personality creation) are linear
   wizards launched from a single button.
6. **Home drives the next action.** The Home page answers "am I OK?" and "what's next?" with a
   status banner and a checklist that deep-links to the right page.
7. **Fix confusions at the point of action.** The "install ≠ select" problem is solved where it
   happens: when an install completes, the library itself asks "Use it for Chat now?" — the user
   never has to learn what a Loadout is.

## New information architecture

Five sidebar entries, each named by the user's question:

1. **Home** — "Who's answering for me, and is everything OK?" A status banner (healthy /
   something wrong), a "Your setup" summary card in plain language ("Chat answers via GPT-5
   (cloud) · Images via Qwen3-VL (on this device)") with a Change button going to Answers, the
   getting-started checklist (only while setup is incomplete), and small stat tiles (this month's
   usage, active personality).
2. **Answers** — "How should the AI answer?" Merges old Connectors + Models + Loadouts into one
   intent-driven page. Top: three preset cards — **Best quality** (cloud, strongest, costs per
   use, data leaves the device), **Balanced** (recommended; cloud for hard questions, local for
   the rest), **Private & free** (everything on this device) — each with Apply and a
   plain-language confirmation of what changed. Below, collapsed-by-default advanced sections:
   **Connected services** (old Connectors: auth state, Add/Test), **Model library** (old Models:
   Installed | Discover, with the post-install "Use it for Chat now?" inline prompt), and
   **Fine-tune per capability** (old Loadouts, labeled Advanced: Chat/Image/Embedding routing).
3. **Personality** — "What personality does it use with me?" (old Profiles, unchanged concept:
   library, All/Recommended/Mine filter chips, New-personality wizard.)
4. **Usage & Access** — "How much has been used, and who can use it?" Usage stats (tokens, cost,
   images this month, per-service breakdown), the external-agent token table, and data & storage.
5. **Status** — "Is something broken?" Health of each service with a pointer button to the page
   that fixes it, plus the plain-language activity log.

Plus the **Setup Guide** wizard (first-run, launched from the Home checklist): Step 1 asks the
intent question "How should Nimi answer?" (the three presets; cloud-leaning or local-leaning) →
Step 2 confirms the setup in plain language → Step 3 picks a personality → Done.

## Old → new mapping

| Old location | New home |
| --- | --- |
| Overview | Home (status banner, plain-language setup summary, checklist, usage/personality tiles) |
| Cloud Connectors | Answers › Connected services (collapsed advanced section) |
| Model Market | Answers › Model library › Discover |
| Local Assets (installed inventory) | Answers › Model library › Installed |
| Local Assets (downloads) | Answers › Model library › Installed (progress rows) |
| Local Assets (imports) | Answers › Model library › Installed ("Import file" action) |
| Loadouts (per-capability subtabs: Chat / Image / Embedding) | Answers › Fine-tune per capability (Advanced) — plus presets for the 90% case |
| Profiles › Recommended | Personality (filter chip "Recommended") |
| Profiles › My Profiles | Personality (filter chip "Mine") |
| Profiles › From current model setup | Personality › New-personality wizard › step 1 "From current setup" |
| Profiles › Author manually | Personality › New-personality wizard › step 1 "Author manually" |
| Environment › Local AI | Status › "What's running" (on-device AI engine row) |
| Environment › Health | Status › "What's running" + attention banner |
| Environment › Activity | Status › "What happened" log |
| Environment › Access (external-agent tokens) | Usage & Access › "Who else can use Nimi" |
| Environment › Data & Storage | Usage & Access › "Data & storage" |

## User flows

### A) First-run setup

Cloud-leaning path:

1. Open **Home** → banner says setup isn't finished → click **Setup Guide** (or step 1).
2. Setup Guide step 1 asks "How should Nimi answer?" → choose **Best quality** or **Balanced**.
3. Step 2 confirms in plain language what Nimi will do; if no cloud service exists yet, add one
   (lands in **Answers › Connected services** → Add → Test passes).
4. Step 3: pick a personality → Done.
5. Back on **Home**, the banner is green and "Your setup" describes the choice in plain language.

Local-leaning path:

1. **Home** → **Setup Guide** → step 1: choose **Private & free**.
2. Step 2 confirms the downloads needed; the recommended models install (progress visible in
   **Answers › Model library › Installed**).
3. Step 3: pick a personality → Done. **Home** shows the local setup summary.

### B) "I want better / cheaper / more private answers"

1. Go to **Answers**.
2. Read the three preset cards (quality / cost / privacy trade-offs stated on each card).
3. Click **Apply** on one → confirmation banner states what changed in plain language.
4. Done. One page, one decision — no knowledge of models, connectors, or loadouts required.

### C) "I want this specific model"

1. Go to **Answers** → expand **Model library** → **Discover**.
2. Search or filter → open the model card → **Install**; progress shows under **Installed**.
3. When the install completes, the library asks inline: "Installed. Use it for Chat now?"
4. Click **Use for Chat** → done. The user never visited a routing page and never learned what a
   loadout is. ("Not now" leaves the model in the library for later.)

### D) Switch personality

1. Go to **Personality**.
2. Filter chips (All / Recommended / Mine) → find the target card.
3. Click **Set active** → the Active pill moves; **Home**'s personality tile updates.

### E) "Something broke"

1. **Home** banner turns yellow/red ("1 thing needs attention").
2. Go to **Status** → "What's running" shows which service is failing, with a **Fix in Answers**
   button on the failing row.
3. "What happened" gives the plain-language log around the failure (e.g. a 401 followed by a
   fallback retry).
4. Follow the pointer → fix credentials in **Answers › Connected services** → Test passes →
   **Status** returns to green.

### F) Advanced: fine-tune per capability

1. Go to **Answers** → expand **Fine-tune per capability (Advanced)**.
2. Pick the Chat / Image / Embedding segment.
3. Compare the current routing with alternatives → **Use this routing**.
4. The preset banner on top of Answers notes the setup is now customized.
