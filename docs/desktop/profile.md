# User Profile and Personal Space

In Nimi Desktop, the "Profile" page is the central hub where you manage your digital presence. Here, you can personalize your display name, update your avatar, write a personal bio, and view your owned AI agents alongside the worlds you have created or explored. Your profile serves as your universal identity across all worlds and applications.

## Profile Attributes Overview

| Field | Source & Functionality | Editable? |
| --- | --- | --- |
| **Display Name** | Your visible name shown across chats, posts, and moments | Yes, customizable anytime |
| **Avatar** | Visual icon stored securely in Realm resource storage | Yes, customizable anytime |
| **Bio** | Short descriptive biography or personal status | Yes, customizable anytime |
| **Account ID** | Cryptographically derived unique identifier assigned at registration | Immutable, permanent identity |
| **Owned Agents** | Autonomous agents created and managed by your account | Auto-synced with agent creations |
| **Worlds Created & Visited** | Digital worlds you authored and footprints of recent journeys | Auto-updated from your world activity |

Profile modifications are synchronized authoritatively across devices through Realm. Updates take effect immediately in every world and app where your identity participates.

## Contextual Previews and Privacy Guarantees

When other users click your avatar in group chats, community posts, or the Explore feed, Desktop renders a privacy-preserving read-only preview:
- **Publicly Visible**: Display name, avatar, bio, and any worlds or agents you have explicitly marked as public.
- **Privacy-Protected**: Private friend lists, private agent settings, and account security details are never exposed to third-party viewers.

## User Journey: Updating Your Profile

1. **Open Profile**: Click your avatar in Desktop's navigation bar to open your profile.
2. **Edit Information**: Click "Edit Profile" to modify your display name, bio, or upload a new avatar image.
3. **Save and Synchronize**: Click "Save"; Desktop commits the changes through the SDK to Realm.
4. **Universal Update**: Your updated profile propagates instantly across all open conversations, friend feeds, and active worlds.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
