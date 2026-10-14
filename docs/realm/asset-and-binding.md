# Digital Assets and World Binding Architecture

Within Nimi's digital world framework, content assets are structured across four well-defined conceptual tiers: **Resource**, **OwnableAsset**, **Bundle**, and **Binding**. Rather than treating everything as generic files, this modular design provides precise governance for ownership, composability, and monetization.

## Four Core Asset Entities

### 1. Resource
- **Concept**: Foundational content bytes (e.g., textures, 3D meshes, audio clips, narrative text files).
- **Invariants**: Bound to content hashes and MIME types, but holds no ownership or authorship metadata, enabling safe deduplication and reuse across higher-level assets.

### 2. OwnableAsset
- **Concept**: Standalone digital property with recorded ownership and creation provenance (e.g., an authored sword model, avatar skin, or musical score).
- **Invariants**: Permanently records Owner, Author, and creation lineage; advances through standard lifecycle phases (`DRAFT → READY → ARCHIVED → DELETED`).

### 3. Bundle
- **Concept**: An ordered composite grouping of multiple `OwnableAssets` (e.g., an entire costume set bundling a hat, cloak, and boots).
- **Invariants**: Encapsulates assets without merging them, preserving the independent authorship and ownership of each member asset.

### 4. Binding
- **Concept**: Semantic relationship attaching an asset to a host entity (e.g., attaching a laser sword (`Asset`) to the weapon shop (`Scene`) in Cyber City (`World`)).
- **Binding Kinds**:
  - `PRESENTATION`: Mounted purely for visual decoration or ambience.
  - `USE`: Usable as an interactive object within the scene.
  - `IMPORT`: Linked as a structural dependency for world rules.

## Strict Validity Binding Matrix

To prevent invalid or incompatible asset configurations (e.g., mounting raw audio files as drivable vehicles), Realm enforces an explicit validation matrix:
- Only permissible combinations of `[Object Type] × [Host Type] × [Binding Kind]` are admitted.
- Unregistered or conflicting combinations fail closed, preserving world logic and visual coherence.

## Related Documentation

- [Creator Economy Architecture](/realm/creator-economy)
- [World State Architecture](/realm/world-state)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
