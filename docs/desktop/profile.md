# User Profile and Personal Space

The **Profile** page in Nimi Home brings your public-facing identity and social activity together. Update your display name, avatar and bio, browse posts, collections and likes, or return to the worlds you follow.

## Your Profile and Activity

| Area | What it contains |
| --- | --- |
| **Profile details** | Display name, avatar, bio and other editable account details |
| **Posts** | Posts visible under the current account’s access rules |
| **Collections and Likes** | The corresponding social content, subject to its visibility rules |
| **Followed Worlds** | Available on your own profile; lists the worlds followed on this device for the current account |

The account ID identifies the human account. Character Source profiles and Runtime LocalAgents use separate views; this page is not an inventory of your private Agent conversations or memory.

## Update Your Details

1. Open your profile from the account navigation.
2. Choose **Edit Profile** and update the fields or upload an avatar.
3. Choose **Save** and confirm the result. Desktop submits the changes to Realm through the SDK.
4. Other views show the saved details when their profile data refreshes.

When viewing another person’s profile, the available information and social actions depend on your relationship and Realm’s access rules. Editing controls apply to your own profile.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
