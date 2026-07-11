package runtimeagent

import (
	"encoding/json"
	"strings"
	"testing"
)

func sourceMaterializationFixtureWorldCore(entityIDs []string) map[string]any {
	entities := make([]any, 0, len(entityIDs))
	for _, id := range entityIDs {
		entities = append(entities, map[string]any{"entityId": id, "kind": "person"})
	}
	return map[string]any{
		"identity":     map[string]any{"name": "Fixture World", "summary": "Canonical fixture world."},
		"presentation": map[string]any{},
		"ontology":     map[string]any{"entityKinds": []any{"person"}, "relationshipTypes": []any{}},
		"timeModel":    map[string]any{"mode": "static", "flowRatio": float64(1), "isPaused": false, "anchor": map[string]any{"realStartedAt": "2026-07-10T05:00:00.000Z", "worldStartedAt": "2026-07-10T05:00:00.000Z", "worldStartedAtDisplay": "Fixture"}, "pausedWorldTime": nil, "calendar": nil, "displayFormat": nil},
		"timeline":     map[string]any{"events": []any{}}, "entities": entities, "relationships": []any{}, "systems": []any{}, "scenes": []any{},
		"assets":    map[string]any{"resourceRefs": []any{}, "externalRefs": []any{}, "intents": []any{}},
		"authoring": map[string]any{"source": "runtime-v2-test"},
	}
}

func sourceMaterializationFixtureEntityCore() map[string]any {
	return map[string]any{
		"identity":       map[string]any{"name": "Bound Entity", "summary": "Canonical bound entity.", "kind": "person", "aliases": []any{}},
		"classification": map[string]any{"tags": []any{"person"}, "sourceCategories": []any{}},
		"facts":          []any{}, "evidence": map[string]any{"sourceRefs": []any{"fixture:entity-bound"}, "completeness": "complete"},
		"assets":    map[string]any{"resourceRefs": []any{}, "externalRefs": []any{}, "intents": []any{}},
		"authoring": map[string]any{"source": "runtime-v2-test"},
	}
}

func sourceMaterializationFixtureCharacterCore() map[string]any {
	return map[string]any{
		"identity":           map[string]any{"name": "Mira", "summary": "A canonical character.", "aliases": []any{}},
		"presentation":       map[string]any{"displayName": "Mira", "shortBio": "A test character."},
		"placement":          map[string]any{"worldId": "world-1", "entityId": "entity-bound", "sceneRefs": []any{}},
		"biography":          map[string]any{"milestones": []any{}, "sourceNotes": []any{}},
		"psychology":         map[string]any{"drives": []any{"understand"}, "boundaries": []any{}},
		"knowledge":          map[string]any{"topics": []any{"fixtures"}, "constraints": []any{}},
		"relationships":      []any{map[string]any{"relationshipId": "explicit-reference", "targetRef": map[string]any{"kind": "worldEntity", "worldId": "world-1", "entityId": "entity-explicit"}, "relationType": "knows"}},
		"capabilities":       map[string]any{"interactionModes": []any{"conversation"}, "tools": []any{}},
		"interactionProfile": map[string]any{"tone": "calm", "cadence": "measured"},
		"assets":             map[string]any{"resourceRefs": []any{}, "externalRefs": []any{}, "intents": []any{}},
		"authoring":          map[string]any{"source": "runtime-v2-test"},
	}
}

func sourceMaterializationFixturePersonaCore() map[string]any {
	return map[string]any{
		"identity":           map[string]any{"handle": "solace", "name": "Solace", "summary": "A canonical persona.", "aliases": []any{}},
		"presentation":       map[string]any{"displayName": "Solace", "profileLine": "Clear and calm."},
		"personaStyle":       map[string]any{"archetype": "advisor", "traits": []any{"calm", "direct"}, "voice": "clear", "pacing": "measured"},
		"contentProfile":     map[string]any{"topics": []any{"fixtures"}, "boundaries": []any{}, "guidelines": []any{}},
		"interactionProfile": map[string]any{"homeWorldId": "world-1", "interactionModes": []any{"conversation"}},
		"assets":             map[string]any{"resourceRefs": []any{}, "externalRefs": []any{}, "intents": []any{}},
		"authoring":          map[string]any{"source": "runtime-v2-test"},
	}
}

func sourceMaterializationFixtureHash(t *testing.T, value any) string {
	t.Helper()
	hash, err := hashSourceMaterializationDomainlessJCS(value)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

func sourceMaterializationFixtureBytes(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := canonicalizeSourceMaterializationJCS(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func sourceMaterializationFixtureDescriptor(t *testing.T, id, kind, schema string, revision uint64, contentHash string, raw []byte) sourceMaterializationManifestComponentV1 {
	t.Helper()
	return sourceMaterializationManifestComponentV1{ComponentID: id, Kind: kind, SchemaVersion: schema, Revision: revision, ContentHash: contentHash, CanonicalBytesHash: sha256HexBytes(raw), CanonicalByteLength: uint64(len(raw))}
}

func sourceMaterializationNormalizeFixture(t *testing.T, kind string, packetID string) (*verifiedSourceMaterializationBeginV2, map[string][]byte) {
	t.Helper()
	origin := map[string]any{"kind": "manual"}
	worldCore := sourceMaterializationFixtureWorldCore(nil)
	if kind == "worldCharacter" {
		worldCore = sourceMaterializationFixtureWorldCore([]string{"entity-bound", "entity-explicit"})
	}
	worldHashInput := map[string]any{"schemaVersion": "realm.world-core/v1", "origin": origin, "creatorId": "owner-1", "visibility": "public", "core": worldCore}
	worldHash := sourceMaterializationFixtureHash(t, worldHashInput)
	worldRecord := map[string]any{"id": "world-1", "schemaVersion": "realm.world-core/v1", "contentRevision": float64(2), "contentHash": worldHash, "origin": origin, "creatorId": "owner-1", "visibility": "public", "core": worldCore, "createdAt": "2026-07-10T05:00:00.000Z", "updatedAt": "2026-07-10T05:00:00.000Z"}
	worldRaw := sourceMaterializationFixtureBytes(t, worldRecord)
	var world sourceMaterializationWorldV1
	if err := strictDecodeSourceMaterializationJSON(worldRaw, &world); err != nil {
		t.Fatal(err)
	}

	components := make([]sourceMaterializationManifestComponentV1, 0, 4)
	componentBytes := map[string][]byte{}
	var sourceUnion sourceMaterializationSourceUnionV2
	var closureUnion sourceMaterializationClosureUnionV1
	var sourceRef sourceMaterializationSourceRefV2
	if kind == "worldCharacter" {
		core := sourceMaterializationFixtureCharacterCore()
		hash := sourceMaterializationFixtureHash(t, map[string]any{"schemaVersion": "realm.world-character-core/v1", "origin": origin, "worldId": "world-1", "entityId": "entity-bound", "core": core})
		record := map[string]any{"kind": "worldCharacter", "id": "character-1", "schemaVersion": "realm.world-character-core/v1", "contentRevision": float64(3), "contentHash": hash, "createdAt": "2026-07-10T05:00:00.000Z", "updatedAt": "2026-07-10T05:00:00.000Z", "origin": origin, "creatorId": "character-creator-2", "visibility": "unlisted", "worldId": "world-1", "entityId": "entity-bound", "core": core}
		raw := sourceMaterializationFixtureBytes(t, record)
		var source sourceMaterializationWorldCharacterV2
		if err := strictDecodeSourceMaterializationJSON(raw, &source); err != nil {
			t.Fatal(err)
		}
		sourceID := compactMaterializationRef("worldCharacter", "world-1", "character-1")
		components = append(components, sourceMaterializationFixtureDescriptor(t, sourceID, "worldCharacter", source.SchemaVersion, source.ContentRevision, source.ContentHash, raw))
		componentBytes[sourceID] = raw
		entityCore := sourceMaterializationFixtureEntityCore()
		entityHash := sourceMaterializationFixtureHash(t, map[string]any{"schemaVersion": "realm.world-entity-core/v1", "origin": origin, "worldId": "world-1", "kind": "person", "core": entityCore})
		entityRecord := map[string]any{"id": "entity-bound", "schemaVersion": "realm.world-entity-core/v1", "contentRevision": float64(1), "contentHash": entityHash, "origin": origin, "worldId": "world-1", "kind": "person", "core": entityCore, "createdAt": "2026-07-10T05:00:00.000Z", "updatedAt": "2026-07-10T05:00:00.000Z"}
		entityRaw := sourceMaterializationFixtureBytes(t, entityRecord)
		var entity sourceMaterializationEntityV1
		if err := strictDecodeSourceMaterializationJSON(entityRaw, &entity); err != nil {
			t.Fatal(err)
		}
		explicitRecord := map[string]any{"id": "entity-explicit", "schemaVersion": "realm.world-entity-core/v1", "contentRevision": float64(1), "contentHash": entityHash, "origin": origin, "worldId": "world-1", "kind": "person", "core": entityCore, "createdAt": "2026-07-10T05:00:00.000Z", "updatedAt": "2026-07-10T05:00:00.000Z"}
		explicitRaw := sourceMaterializationFixtureBytes(t, explicitRecord)
		var explicitEntity sourceMaterializationEntityV1
		if err := strictDecodeSourceMaterializationJSON(explicitRaw, &explicitEntity); err != nil {
			t.Fatal(err)
		}
		sourceUnion.Character = &source
		closureUnion.Character = &sourceMaterializationCharacterClosureV1{Kind: "worldCharacter", BoundEntity: entity, IncidentRelationships: []sourceMaterializationRelationshipV1{}, EndpointEntities: []sourceMaterializationEntityV1{}, ExplicitDependencies: []sourceMaterializationDependencyRefV1{{Kind: "worldEntity", WorldID: "world-1", ID: "entity-explicit", ContentHash: entityHash}}}
		sourceRef = sourceMaterializationSourceRefV2{Kind: kind, WorldID: "world-1", SourceID: "character-1", SourceContentHash: hash}
		worldID := compactMaterializationRef("worldCore", "world-1", "world-1")
		components = append(components, sourceMaterializationFixtureDescriptor(t, worldID, "worldCore", world.SchemaVersion, world.ContentRevision, world.ContentHash, worldRaw))
		componentBytes[worldID] = worldRaw
		entityID := compactMaterializationRef("worldEntity", "world-1", "entity-bound")
		components = append(components, sourceMaterializationFixtureDescriptor(t, entityID, "worldEntity", entity.SchemaVersion, entity.ContentRevision, entity.ContentHash, entityRaw))
		componentBytes[entityID] = entityRaw
		explicitID := compactMaterializationRef("worldEntity", "world-1", "entity-explicit")
		components = append(components, sourceMaterializationFixtureDescriptor(t, explicitID, "worldEntity", explicitEntity.SchemaVersion, explicitEntity.ContentRevision, explicitEntity.ContentHash, explicitRaw))
		componentBytes[explicitID] = explicitRaw
	} else {
		core := sourceMaterializationFixturePersonaCore()
		hash := sourceMaterializationFixtureHash(t, map[string]any{"schemaVersion": "realm.persona/v1", "origin": origin, "ownerId": "owner-1", "homeWorldId": "world-1", "visibility": "public", "core": core})
		record := map[string]any{"kind": "realmPersona", "id": "persona-1", "schemaVersion": "realm.persona/v1", "contentRevision": float64(4), "contentHash": hash, "createdAt": "2026-07-10T05:00:00.000Z", "updatedAt": "2026-07-10T05:00:00.000Z", "origin": origin, "ownerId": "owner-1", "homeWorldId": "world-1", "visibility": "public", "core": core}
		raw := sourceMaterializationFixtureBytes(t, record)
		var source sourceMaterializationRealmPersonaV2
		if err := strictDecodeSourceMaterializationJSON(raw, &source); err != nil {
			t.Fatal(err)
		}
		sourceID := compactMaterializationRef("realmPersona", "world-1", "persona-1")
		components = append(components, sourceMaterializationFixtureDescriptor(t, sourceID, "realmPersona", source.SchemaVersion, source.ContentRevision, source.ContentHash, raw))
		componentBytes[sourceID] = raw
		sourceUnion.Persona = &source
		closureUnion.Persona = &sourceMaterializationPersonaClosureV1{Kind: "realmPersona", ExplicitDependencies: []sourceMaterializationDependencyRefV1{}}
		sourceRef = sourceMaterializationSourceRefV2{Kind: kind, WorldID: "world-1", SourceID: "persona-1", SourceContentHash: hash}
		worldID := compactMaterializationRef("worldCore", "world-1", "world-1")
		components = append(components, sourceMaterializationFixtureDescriptor(t, worldID, "worldCore", world.SchemaVersion, world.ContentRevision, world.ContentHash, worldRaw))
		componentBytes[worldID] = worldRaw
	}
	coverageID := compactMaterializationRef("coverageManifest", "manifest", packetID)
	components = append(components, sourceMaterializationManifestComponentV1{ComponentID: coverageID, Kind: "coverageManifest", SchemaVersion: sourceMaterializationCoverageV1, Revision: 1, ContentHash: strings.Repeat("0", 64), CanonicalBytesHash: strings.Repeat("0", 64), CanonicalByteLength: 1})
	begin := &verifiedSourceMaterializationBeginV2{Envelope: sourceMaterializationPacketEnvelopeV2{PacketID: packetID, SourceRef: sourceRef, Issuer: "https://realm.test", KeyID: "materialization-key-1"}, Manifest: sourceMaterializationBundleManifestValueV1{Components: components}, KeyFingerprint: strings.Repeat("f", 64)}
	coverage := buildExpectedSourceMaterializationCoverage(begin, sourceUnion.Character, sourceUnion.Persona, world, closureUnion)
	unsigned, err := coverageWithoutHash(coverage)
	if err != nil {
		t.Fatal(err)
	}
	coverage.CoverageManifestHash, err = hashSourceMaterializationDomainJCS(sourceMaterializationCoverageHashDomain, unsigned)
	if err != nil {
		t.Fatal(err)
	}
	coverageRaw := sourceMaterializationFixtureBytes(t, coverage)
	components[len(components)-1] = sourceMaterializationFixtureDescriptor(t, coverageID, "coverageManifest", sourceMaterializationCoverageV1, 1, coverage.CoverageManifestHash, coverageRaw)
	componentBytes[coverageID] = coverageRaw
	begin.Manifest.Components = components
	componentDigests := make([]sourceMaterializationComponentDigestV1, 0, len(components)-1)
	for _, item := range components[:len(components)-1] {
		componentDigests = append(componentDigests, sourceMaterializationComponentDigestV1{ComponentID: item.ComponentID, Kind: item.Kind, ContentHash: item.ContentHash})
	}
	contextInput := struct {
		ContextSchemaVersion            string                                   `json:"contextSchemaVersion"`
		SourceComponentDigests          []sourceMaterializationComponentDigestV1 `json:"sourceComponentDigests"`
		WorldAndClosureComponentDigests []sourceMaterializationComponentDigestV1 `json:"worldAndClosureComponentDigests"`
		ClosurePolicyVersion            string                                   `json:"closurePolicyVersion"`
		CoverageManifestHash            string                                   `json:"coverageManifestHash"`
	}{sourceMaterializationContextV1, componentDigests[:1], componentDigests[1:], sourceMaterializationClosureV1, coverage.CoverageManifestHash}
	contextHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationContextHashDomain, contextInput)
	if err != nil {
		t.Fatal(err)
	}
	contextValue := sourceMaterializationContextValueV1{ContextSchemaVersion: sourceMaterializationContextV1, SourceRef: sourceRef, OwningWorld: world, DependencyClosure: closureUnion, SourceComponentDigests: componentDigests[:1], WorldAndClosureComponentDigests: componentDigests[1:], ClosurePolicyVersion: sourceMaterializationClosureV1, CoverageManifestHash: coverage.CoverageManifestHash, MaterializationContextHash: contextHash}
	payload := sourceMaterializationPayloadValueV2{PayloadSchemaVersion: sourceMaterializationPayloadV2SchemaVersion, PayloadAssemblyVersion: sourceMaterializationAssemblyV1, Source: sourceUnion, MaterializationContext: contextValue, CoverageManifest: coverage, CoverageManifestHash: coverage.CoverageManifestHash, MaterializationContextHash: contextHash}
	begin.Envelope.PayloadHash, err = hashSourceMaterializationDomainJCS(sourceMaterializationPayloadHashDomain, payload)
	if err != nil {
		t.Fatal(err)
	}
	begin.PacketHash = strings.Repeat("a", 64)
	begin.BundleManifestHash = strings.Repeat("b", 64)
	begin.Envelope.BundleManifestHash = begin.BundleManifestHash
	return begin, componentBytes
}

func TestVerifyAndNormalizeSourceMaterializationV2CharacterAndPersona(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"worldCharacter", "realmPersona"} {
		t.Run(kind, func(t *testing.T) {
			begin, components := sourceMaterializationNormalizeFixture(t, kind, "packet-1")
			normalized, err := verifyAndNormalizeSourceMaterializationV2(begin, components)
			if err != nil {
				t.Fatalf("verifyAndNormalizeSourceMaterializationV2: %v", err)
			}
			if normalized.SourceRef.Kind != kind || !isLowerSHA256(normalized.SnapshotHash) || normalized.PayloadHash != begin.Envelope.PayloadHash {
				t.Fatalf("normalized result = %#v", normalized)
			}
			if kind == "worldCharacter" && (normalized.CharacterClosure == nil || len(normalized.CharacterClosure.ExplicitEntities) != 1 || normalized.CharacterClosure.ExplicitEntities[0].ID != "entity-explicit") {
				t.Fatalf("explicit canonical dependency was not retained: %#v", normalized.CharacterClosure)
			}
			golden := map[string][4]string{
				"worldCharacter": {"159fc1280c54b9fd0ff735b5fa0b102d45f9fac1999e0167f6dbdad12cdfa368", "7bedd8406c99468168878131a034b1f8c691179d3790ba6710ffdd04b83d46d8", "536a389b3b461c2e3842279b44ef7a4ec0174ec4a005d4e43d49a62bc94db9c2", "dca04aa7abe214ef0a126b622d57a8d2c0014a23feece6fa488f33c6729a95c2"},
				"realmPersona":   {"39531106f40afad1cc294287991a5ef3a7c78c68f76bd8dedf51b50a74802be8", "06cc8355a20729ac06f63c75fabe5c45bd5d53d8ad27a056cc2f6f861ee91a20", "6202dfb677290cbfa3691e99cb3798c1c9ec1ceb8892fc722c77ae8d9c8301a4", "16090cece7d774de28aa86361da79676614d945d0b7ed4219c3858ae9d934ec9"},
			}[kind]
			if got := [4]string{normalized.PayloadHash, normalized.MaterializationContextHash, normalized.CoverageManifestHash, normalized.SnapshotHash}; got != golden {
				t.Fatalf("golden hash graph drifted: got=%v want=%v", got, golden)
			}
			if err := validateNormalizedSourceMaterializationV2(*normalized); err != nil {
				t.Fatalf("validateNormalizedSourceMaterializationV2: %v", err)
			}
			if normalized.Persona != nil {
				altered := normalized.SnapshotHashInput
				persona := *altered.Source.Persona
				traits := append([]string(nil), persona.Core.PersonaStyle.Traits...)
				traits[0], traits[1] = traits[1], traits[0]
				persona.Core.PersonaStyle.Traits = traits
				altered.Source.Persona = &persona
				alteredHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationSnapshotHashDomain, altered)
				if err != nil || alteredHash == normalized.SnapshotHash {
					t.Fatalf("semantic array order did not affect snapshot hash: hash=%s err=%v", alteredHash, err)
				}
			}
			normalized.SnapshotHash = strings.Repeat("0", 64)
			if err := validateNormalizedSourceMaterializationV2(*normalized); err == nil {
				t.Fatal("snapshot hash corruption was admitted on readback")
			}
		})
	}
	firstBegin, firstComponents := sourceMaterializationNormalizeFixture(t, "realmPersona", "packet-1")
	secondBegin, secondComponents := sourceMaterializationNormalizeFixture(t, "realmPersona", "packet-2")
	first, err := verifyAndNormalizeSourceMaterializationV2(firstBegin, firstComponents)
	if err != nil {
		t.Fatal(err)
	}
	second, err := verifyAndNormalizeSourceMaterializationV2(secondBegin, secondComponents)
	if err != nil {
		t.Fatal(err)
	}
	if first.SnapshotHash != second.SnapshotHash {
		t.Fatalf("issuance changed semantic snapshot hash: %s != %s", first.SnapshotHash, second.SnapshotHash)
	}
}

func TestVerifyAndNormalizeSourceMaterializationV2RejectsClosedSchemaAndCoverageTampering(t *testing.T) {
	t.Parallel()
	tests := map[string]func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte){
		"unknown source field": func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			id := begin.Manifest.Components[0].ComponentID
			var value map[string]any
			_ = json.Unmarshal(components[id], &value)
			value["systemPromptBase"] = "bypass"
			components[id] = sourceMaterializationFixtureBytes(t, value)
			begin.Manifest.Components[0].CanonicalByteLength = uint64(len(components[id]))
			begin.Manifest.Components[0].CanonicalBytesHash = sha256HexBytes(components[id])
		},
		"core kind mismatch": func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			id := begin.Manifest.Components[0].ComponentID
			var value map[string]any
			_ = json.Unmarshal(components[id], &value)
			value["kind"] = "worldCharacter"
			components[id] = sourceMaterializationFixtureBytes(t, value)
			begin.Manifest.Components[0].CanonicalByteLength = uint64(len(components[id]))
			begin.Manifest.Components[0].CanonicalBytesHash = sha256HexBytes(components[id])
		},
		"incomplete coverage": func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			index := len(begin.Manifest.Components) - 1
			id := begin.Manifest.Components[index].ComponentID
			var value map[string]any
			_ = json.Unmarshal(components[id], &value)
			value["aggregateStatus"] = "incomplete"
			components[id] = sourceMaterializationFixtureBytes(t, value)
			begin.Manifest.Components[index].CanonicalByteLength = uint64(len(components[id]))
			begin.Manifest.Components[index].CanonicalBytesHash = sha256HexBytes(components[id])
		},
		"missing required core section": func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			id := begin.Manifest.Components[0].ComponentID
			var value map[string]any
			_ = json.Unmarshal(components[id], &value)
			delete(value["core"].(map[string]any), "personaStyle")
			components[id] = sourceMaterializationFixtureBytes(t, value)
			begin.Manifest.Components[0].CanonicalByteLength = uint64(len(components[id]))
			begin.Manifest.Components[0].CanonicalBytesHash = sha256HexBytes(components[id])
		},
		"wrong nested type": func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			id := begin.Manifest.Components[0].ComponentID
			var value map[string]any
			_ = json.Unmarshal(components[id], &value)
			value["core"].(map[string]any)["personaStyle"].(map[string]any)["traits"] = "calm"
			components[id] = sourceMaterializationFixtureBytes(t, value)
			begin.Manifest.Components[0].CanonicalByteLength = uint64(len(components[id]))
			begin.Manifest.Components[0].CanonicalBytesHash = sha256HexBytes(components[id])
		},
		"unknown visibility enum": func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			id := begin.Manifest.Components[0].ComponentID
			var value map[string]any
			_ = json.Unmarshal(components[id], &value)
			value["visibility"] = "friends"
			components[id] = sourceMaterializationFixtureBytes(t, value)
			begin.Manifest.Components[0].CanonicalByteLength = uint64(len(components[id]))
			begin.Manifest.Components[0].CanonicalBytesHash = sha256HexBytes(components[id])
		},
		"home world ref mismatch": func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			id := begin.Manifest.Components[0].ComponentID
			var value map[string]any
			_ = json.Unmarshal(components[id], &value)
			value["core"].(map[string]any)["interactionProfile"].(map[string]any)["homeWorldId"] = "world-other"
			components[id] = sourceMaterializationFixtureBytes(t, value)
			begin.Manifest.Components[0].CanonicalByteLength = uint64(len(components[id]))
			begin.Manifest.Components[0].CanonicalBytesHash = sha256HexBytes(components[id])
		},
		"raw prompt hidden in admitted extension": func(t *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			id := begin.Manifest.Components[0].ComponentID
			var value map[string]any
			_ = json.Unmarshal(components[id], &value)
			value["core"].(map[string]any)["authoring"].(map[string]any)["extensions"] = map[string]any{"systemPromptBase": "bypass"}
			components[id] = sourceMaterializationFixtureBytes(t, value)
			begin.Manifest.Components[0].CanonicalByteLength = uint64(len(components[id]))
			begin.Manifest.Components[0].CanonicalBytesHash = sha256HexBytes(components[id])
		},
		"payload hash tamper": func(_ *testing.T, begin *verifiedSourceMaterializationBeginV2, _ map[string][]byte) {
			begin.Envelope.PayloadHash = strings.Repeat("0", 64)
		},
		"component byte digest tamper": func(_ *testing.T, begin *verifiedSourceMaterializationBeginV2, components map[string][]byte) {
			id := begin.Manifest.Components[0].ComponentID
			components[id][0] ^= 1
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			begin, components := sourceMaterializationNormalizeFixture(t, "realmPersona", "packet-tamper")
			mutate(t, begin, components)
			if _, err := verifyAndNormalizeSourceMaterializationV2(begin, components); err == nil {
				t.Fatal("tampered packet was admitted")
			}
		})
	}
	t.Run("cross-world Character target ref", func(t *testing.T) {
		begin, components := sourceMaterializationNormalizeFixture(t, "worldCharacter", "packet-character-ref")
		id := begin.Manifest.Components[0].ComponentID
		var value map[string]any
		_ = json.Unmarshal(components[id], &value)
		relationship := value["core"].(map[string]any)["relationships"].([]any)[0].(map[string]any)
		relationship["targetRef"].(map[string]any)["worldId"] = "world-other"
		components[id] = sourceMaterializationFixtureBytes(t, value)
		begin.Manifest.Components[0].CanonicalByteLength = uint64(len(components[id]))
		begin.Manifest.Components[0].CanonicalBytesHash = sha256HexBytes(components[id])
		if _, err := verifyAndNormalizeSourceMaterializationV2(begin, components); err == nil {
			t.Fatal("cross-world Character ref was admitted")
		}
	})
}
