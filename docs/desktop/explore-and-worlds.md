# Discovering Worlds & Personas

In Nimi Home's **Explore** view, you can roam digital worlds built by creators across the ecosystem, read their lore and foundational rules, and meet the characters who inhabit them. When a character resonates with you, you can add them as a personal companion (`LocalAgent`).

---

## The Exploration Experience

1. **Browse Public Worlds**
   - Explore diverse settings—from floating acoustic archipelagos to neon-lit sci-fi cities and quiet sanctuaries.
   - Inspect each world's canonical laws, social rules, geography, and character relationships.
2. **Meet Native Characters**
   - Open public persona profiles to learn a character's personality, backstory, and speaking style.
   - Every profile is backed by public source records registered in Realm.
3. **Add a Companion (`LocalAgent`)**
   - When both the character's source record and your account meet eligibility requirements, you can use the add-companion action on the profile page.
   - Your local Runtime initializes a dedicated **LocalAgent** on your machine from that character's source definition.
   - Your `LocalAgent` maintains its own conversation history and optional long-term memory. If you choose a cloud provider for inference, relevant conversation and memory context may be sent to that provider.

---

## Privacy & Session Boundaries

- **Public Lore vs. Private Memories**: Viewing a public character never exposes anyone else's private conversations or personal memories with that character.
- **Non-Disruptive Browsing**: Exploring worlds and profiles is a read-only experience that never interrupts or overwrites your active chat session in Nimi Home.

## Next Steps

- [Realm Canonical Truth & World State](/realm/truth)
- [Cross-World Roaming Protocols (Transit)](/realm/transit)
- [Build a Nimi App](/start/)

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/world/world-detail.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail.tsx)
