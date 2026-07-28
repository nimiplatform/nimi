# Profile

Desktop's profile surface lets a user view and edit their own
profile, update their avatar, see the agents they own, and see the
worlds they have created or visited. The profile is canonical
identity — the same identity that travels across every world.

## What The Profile Carries

| Field | Source |
| --- | --- |
| Display name | Realm canonical user identity |
| Profile avatar | Realm asset reference |
| Owned agents | Realm agent reads — the agents this user owns |
| Created worlds | Realm world reads — worlds this user has authored |
| Visited worlds | Realm world history projection |
| Bio / description | User-editable profile field |

Profile is canonical, not Desktop-local. Editing the profile
mutates Realm under admitted profile contracts; Desktop is the
editor surface, not the truth holder.

## Profile Detail As A Shared Surface

Other parts of Desktop (chat profile preview, explore profile
preview) consume the same profile detail seam. The profile detail
read is one shape; consumers project as needed.

## Reader Scenario: Editing Your Profile

You open your profile in Desktop and update your display name.

1. **Open profile.** Desktop reads your profile from Realm.
2. **Edit.** You change the display name in the editor.
3. **Save.** Desktop submits a typed profile mutation to Realm.
4. **Realm admits.** The profile is updated under admitted
   profile contracts.
5. **Cross-app visibility.** The new display name is visible in
   every app and every world the user appears in.
6. **Audit.** The profile change is recorded.

Your profile is one identity across the platform; Desktop is one
editor for it.

## Reader Scenario: Viewing Another User's Profile

You click into another user's profile from chat.

1. **Profile preview.** A bounded `ProfileDisplayDetail` seam
   resolves the user's public profile.
2. **What you see.** Display name, avatar, public agents (owned
   agents the other user has set as visible), public worlds.
3. **What you do not see.** Private profile fields, friend lists,
   wallet balance — those are not part of the public detail.

The public profile is intentionally narrow. Privacy is enforced
by the seam, not by client-side filtering.

## Profile And Identity

Profile is the user-editable surface around an identity that is
itself canonical and not directly mutable from the profile.

| Concept | Mutable from Profile? |
| --- | --- |
| Display name | yes |
| Profile avatar (visual) | yes |
| Bio / description | yes |
| User identity (canonical id) | no — fixed at account creation |
| Wallet balance | no — economy events |
| Owned agents (the agents themselves) | no — agent authority lives in Realm |

You can edit how you appear; you cannot edit who you are.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
