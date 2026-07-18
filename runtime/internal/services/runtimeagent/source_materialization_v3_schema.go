package runtimeagent

import (
	"fmt"
	"regexp"
	"strings"
)

type sourceMaterializationProfileExtensionRegistrationV3 struct {
	schemaVersion   string
	productSemantic bool
}

var sourceMaterializationCredentialParameterV3 = regexp.MustCompile(`(?i)^(?:x-amz-.+|x-goog-.+|access[_-]?token|token|api[_-]?key|apikey|key|secret|sig(?:nature)?|credential|expires?|policy|auth(?:orization)?|awsaccesskeyid|googleaccessid)$`)

var sourceMaterializationEncodedCredentialSeparatorV3 = regexp.MustCompile(`(?i)(?:%3f|%26|%23)(?:x-amz-[^=&%#]+|x-goog-[^=&%#]+|access[_-]?token|token|api[_-]?key|apikey|key|secret|sig(?:nature)?|credential|expires?|policy|auth(?:orization)?|awsaccesskeyid|googleaccessid)=`)

var sourceMaterializationResourceSchemeV3 = regexp.MustCompile(`(?i)^[a-z][a-z0-9+.-]*:`)

var sourceMaterializationResourceCredentialV3 = regexp.MustCompile(`(?i)(?:[?&#]|%3f|%26|%23)(?:x-amz-[^=&%#]+|x-goog-[^=&%#]+|access[_-]?token|token|api[_-]?key|apikey|key|secret|sig(?:nature)?|credential|expires?|policy|auth(?:orization)?)=`)

func sourceMaterializationProfileExtensionRegistrationForV3(namespace string) (sourceMaterializationProfileExtensionRegistrationV3, bool) {
	switch namespace {
	case "realm.character-context":
		return sourceMaterializationProfileExtensionRegistrationV3{schemaVersion: "realm.character-context/v1", productSemantic: true}, true
	case "works.nimi.role-setting":
		return sourceMaterializationProfileExtensionRegistrationV3{schemaVersion: "role-setting/v1", productSemantic: true}, true
	case "works.nimi.diagnostics":
		return sourceMaterializationProfileExtensionRegistrationV3{schemaVersion: "diag/v1", productSemantic: false}, true
	default:
		return sourceMaterializationProfileExtensionRegistrationV3{}, false
	}
}

func validateSourceMaterializationPacketShapeV3(value any, limits sourceMaterializationPublishedLimitsV3) error {
	if err := validateSourceMaterializationNormalizedKeysV3(value, "$"); err != nil {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "%v", err)
	}
	packet, err := sourceMaterializationClosedObjectV3(value, "$", []string{
		"packetSchemaVersion", "packetId", "issuer", "keyId", "algorithm", "keyUse", "issuedAt", "expiresAt", "nonce",
		"intendedRuntimeAudience", "challengeId", "challengeDigest", "publishedLimits", "materializerAccountId", "sourceRef",
		"authorizationDecisionDigest", "accessPolicyVersionDigest", "materializationContextHash", "payloadHash",
		"closureSetManifestHash", "packetHash", "packetProof", "semanticPayload", "closureSetManifest", "orderedSegments",
	}, nil)
	if err != nil {
		return err
	}
	if err := validateSourceMaterializationLimitsShapeV3(packet["publishedLimits"], "$.publishedLimits"); err != nil {
		return err
	}
	if err := validateSourceMaterializationSourceRefShapeV3(packet["sourceRef"], "$.sourceRef"); err != nil {
		return err
	}
	if _, err := sourceMaterializationClosedObjectV3(packet["packetProof"], "$.packetProof", []string{"compactJws", "signedPayload"}, nil); err != nil {
		return err
	}
	if err := validateSourceMaterializationPayloadShapeV3(packet["semanticPayload"], "$.semanticPayload", limits); err != nil {
		return err
	}
	if err := validateSourceMaterializationClosureSetShapeV3(packet["closureSetManifest"], "$.closureSetManifest", limits); err != nil {
		return err
	}
	segments, err := sourceMaterializationArrayV3(packet["orderedSegments"], "$.orderedSegments", limits.MaxSetSegments, false)
	if err != nil {
		return err
	}
	for index, segment := range segments {
		if err := validateSourceMaterializationSegmentShapeV3(segment, fmt.Sprintf("$.orderedSegments[%d]", index), limits); err != nil {
			return err
		}
	}
	return nil
}

func validateSourceMaterializationJWKSShapeV3(value any) error {
	if err := validateSourceMaterializationNormalizedKeysV3(value, "$"); err != nil {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "%v", err)
	}
	document, err := sourceMaterializationClosedObjectV3(value, "$", []string{"keys"}, nil)
	if err != nil {
		return err
	}
	keys, err := sourceMaterializationArrayV3(document["keys"], "$.keys", 128, false)
	if err != nil {
		return err
	}
	for index, key := range keys {
		keyObject, err := sourceMaterializationClosedObjectV3(key, fmt.Sprintf("$.keys[%d]", index), []string{
			"kty", "kid", "use", "alg", "key_ops", "n", "e", "purpose",
		}, nil)
		if err != nil {
			return err
		}
		if _, err := sourceMaterializationArrayV3(keyObject["key_ops"], fmt.Sprintf("$.keys[%d].key_ops", index), 1, false); err != nil {
			return err
		}
	}
	return nil
}

func validateSourceMaterializationPayloadShapeV3(value any, path string, limits sourceMaterializationPublishedLimitsV3) error {
	payload, err := sourceMaterializationClosedObjectV3(value, path, []string{
		"payloadSchemaVersion", "payloadAssemblyVersion", "sourceRef", "canonicalSource", "materializationContext",
		"materializationCoverage", "materializationCoverageHash", "materializationContextHash",
	}, nil)
	if err != nil {
		return err
	}
	if err := validateSourceMaterializationSourceRefShapeV3(payload["sourceRef"], path+".sourceRef"); err != nil {
		return err
	}
	if err := validateSourceMaterializationCanonicalSourceShapeV3(payload["canonicalSource"], path+".canonicalSource"); err != nil {
		return err
	}
	if err := validateSourceMaterializationContextShapeV3(payload["materializationContext"], path+".materializationContext", limits); err != nil {
		return err
	}
	return validateSourceMaterializationCoverageShapeV3(payload["materializationCoverage"], path+".materializationCoverage", limits)
}

func validateSourceMaterializationSourceRefShapeV3(value any, path string) error {
	record, ok := value.(map[string]any)
	if !ok {
		return sourceMaterializationSchemaErrorV3(path, "must be an object")
	}
	kind, _ := record["kind"].(string)
	switch kind {
	case "worldCharacter":
		closed, err := sourceMaterializationClosedObjectV3(value, path, []string{"kind", "id", "worldId", "worldEntityRef", "sourceHash"}, nil)
		if err != nil {
			return err
		}
		_, err = sourceMaterializationClosedObjectV3(closed["worldEntityRef"], path+".worldEntityRef", []string{"kind", "worldId", "entityId"}, nil)
		return err
	case "personaCharacter":
		_, err := sourceMaterializationClosedObjectV3(value, path, []string{"kind", "id", "worldId", "ownerAccountId", "sourceHash"}, nil)
		return err
	default:
		return sourceMaterializationSchemaErrorV3(path+".kind", "is not an admitted source union branch")
	}
}

func validateSourceMaterializationCanonicalSourceShapeV3(value any, path string) error {
	record, ok := value.(map[string]any)
	if !ok {
		return sourceMaterializationSchemaErrorV3(path, "must be an object")
	}
	schema, _ := record["schemaVersion"].(string)
	var required []string
	switch schema {
	case "realm.world-character-core/v1":
		required = []string{"id", "schemaVersion", "contentRevision", "contentHash", "createdAt", "updatedAt", "origin", "creatorId", "visibility", "worldId", "worldEntityRef", "profile", "validity", "materializationReadiness", "sourceHash"}
	case "realm.persona-character-core/v1":
		required = []string{"id", "schemaVersion", "contentRevision", "contentHash", "createdAt", "updatedAt", "origin", "ownerAccountId", "worldId", "visibility", "profile", "validity", "materializationReadiness", "sourceHash"}
	default:
		return sourceMaterializationSchemaErrorV3(path+".schemaVersion", "is not an admitted canonical source union branch")
	}
	closed, err := sourceMaterializationClosedObjectV3(value, path, required, nil)
	if err != nil {
		return err
	}
	if err := validateSourceMaterializationOriginShapeV3(closed["origin"], path+".origin"); err != nil {
		return err
	}
	if schema == "realm.world-character-core/v1" {
		if _, err := sourceMaterializationClosedObjectV3(closed["worldEntityRef"], path+".worldEntityRef", []string{"kind", "worldId", "entityId"}, nil); err != nil {
			return err
		}
	}
	if err := validateSourceMaterializationProfileShapeJSONV3(closed["profile"], path+".profile"); err != nil {
		return err
	}
	if err := validateSourceMaterializationIssueResultShapeV3(closed["validity"], path+".validity", "issues"); err != nil {
		return err
	}
	return validateSourceMaterializationIssueResultShapeV3(closed["materializationReadiness"], path+".materializationReadiness", "blockers")
}

func validateSourceMaterializationProfileShapeJSONV3(value any, path string) error {
	profile, err := sourceMaterializationClosedObjectV3(value, path, []string{
		"profileSchemaVersion", "identity", "presentation", "narrative", "interactionProfile", "assets", "authoring", "profileCoverage", "profileHash",
	}, []string{"psychology", "knowledge", "relationships", "capabilities"})
	if err != nil {
		return err
	}
	if err := sourceMaterializationProfileConstStringV3(profile["profileSchemaVersion"], path+".profileSchemaVersion", "realm.character-profile-core/v1"); err != nil {
		return err
	}
	if err := sourceMaterializationProfileHashStringV3(profile["profileHash"], path+".profileHash"); err != nil {
		return err
	}

	identity, err := sourceMaterializationClosedObjectV3(profile["identity"], path+".identity", []string{"name", "summary"}, []string{"handle", "aliases"})
	if err != nil {
		return err
	}
	if err := sourceMaterializationProfileRequiredStringV3(identity["name"], path+".identity.name"); err != nil {
		return err
	}
	if err := sourceMaterializationProfileRequiredStringV3(identity["summary"], path+".identity.summary"); err != nil {
		return err
	}
	if err := sourceMaterializationProfileOptionalStringV3(identity, "handle", path+".identity.handle", false); err != nil {
		return err
	}
	if aliases, exists := identity["aliases"]; exists {
		if err := sourceMaterializationProfileStringArrayV3(aliases, path+".identity.aliases", sourceMaterializationProfileArraySortedSetV3); err != nil {
			return err
		}
	}

	presentation, err := sourceMaterializationClosedObjectV3(profile["presentation"], path+".presentation", []string{"displayName"}, []string{"shortBio", "profileLine", "avatarResourceRef", "profileCoverResourceRef"})
	if err != nil {
		return err
	}
	if err := sourceMaterializationProfileRequiredStringV3(presentation["displayName"], path+".presentation.displayName"); err != nil {
		return err
	}
	for _, field := range []string{"shortBio", "profileLine"} {
		if err := sourceMaterializationProfileOptionalStringV3(presentation, field, path+".presentation."+field, false); err != nil {
			return err
		}
	}
	for _, field := range []string{"avatarResourceRef", "profileCoverResourceRef"} {
		if raw, exists := presentation[field]; exists {
			text, err := sourceMaterializationProfileStringV3(raw, path+".presentation."+field, false)
			if err != nil {
				return err
			}
			if text != "" && sourceMaterializationUnsafeResourceRefIDV3(text) {
				return sourceMaterializationSchemaErrorV3(path+".presentation."+field, "must be a stable resource id")
			}
		}
	}

	narrative, err := sourceMaterializationClosedObjectV3(profile["narrative"], path+".narrative", []string{"summary"}, []string{"archetype", "traits", "milestones"})
	if err != nil {
		return err
	}
	if err := sourceMaterializationProfileRequiredStringV3(narrative["summary"], path+".narrative.summary"); err != nil {
		return err
	}
	if err := sourceMaterializationProfileOptionalStringV3(narrative, "archetype", path+".narrative.archetype", false); err != nil {
		return err
	}
	if traits, exists := narrative["traits"]; exists {
		if err := sourceMaterializationProfileStringArrayV3(traits, path+".narrative.traits", sourceMaterializationProfileArraySortedSetV3); err != nil {
			return err
		}
	}
	if milestones, exists := narrative["milestones"]; exists {
		items, err := sourceMaterializationArrayV3(milestones, path+".narrative.milestones", 16384, true)
		if err != nil {
			return err
		}
		stableIDs := make([]string, 0, len(items))
		for index, item := range items {
			itemPath := fmt.Sprintf("%s.narrative.milestones[%d]", path, index)
			milestone, err := sourceMaterializationClosedObjectV3(item, itemPath, []string{"milestoneId"}, []string{"sequence", "title", "summary"})
			if err != nil {
				return err
			}
			stableID, err := sourceMaterializationProfileStringV3(milestone["milestoneId"], itemPath+".milestoneId", true)
			if err != nil {
				return err
			}
			stableIDs = append(stableIDs, stableID)
			if sequence, exists := milestone["sequence"]; exists {
				if err := sourceMaterializationProfileFiniteNumberV3(sequence, itemPath+".sequence"); err != nil {
					return err
				}
			}
			for _, field := range []string{"title", "summary"} {
				if err := sourceMaterializationProfileOptionalStringV3(milestone, field, itemPath+"."+field, false); err != nil {
					return err
				}
			}
		}
		if err := sourceMaterializationProfileStableOrderV3(stableIDs, path+".narrative.milestones"); err != nil {
			return err
		}
	}
	for _, field := range []string{"psychology", "knowledge"} {
		if child, exists := profile[field]; exists {
			allowed := []string{"drives", "boundaries"}
			if field == "knowledge" {
				allowed = []string{"topics", "constraints"}
			}
			section, err := sourceMaterializationClosedObjectV3(child, path+"."+field, nil, allowed)
			if err != nil {
				return err
			}
			for _, childField := range allowed {
				if values, exists := section[childField]; exists {
					if err := sourceMaterializationProfileStringArrayV3(values, path+"."+field+"."+childField, sourceMaterializationProfileArraySortedSetV3); err != nil {
						return err
					}
				}
			}
		}
	}
	if child, exists := profile["relationships"]; exists {
		items, err := sourceMaterializationArrayV3(child, path+".relationships", 16384, true)
		if err != nil {
			return err
		}
		stableIDs := make([]string, 0, len(items))
		for index, item := range items {
			itemPath := fmt.Sprintf("%s.relationships[%d]", path, index)
			relationship, err := sourceMaterializationClosedObjectV3(item, itemPath, []string{"relationshipId", "targetRef", "relationType"}, []string{"summary"})
			if err != nil {
				return err
			}
			stableID, err := sourceMaterializationProfileStringV3(relationship["relationshipId"], itemPath+".relationshipId", true)
			if err != nil {
				return err
			}
			stableIDs = append(stableIDs, stableID)
			if _, err := sourceMaterializationProfileStringV3(relationship["relationType"], itemPath+".relationType", true); err != nil {
				return err
			}
			if err := sourceMaterializationProfileOptionalStringV3(relationship, "summary", itemPath+".summary", false); err != nil {
				return err
			}
			targetPath := itemPath + ".targetRef"
			target, err := sourceMaterializationClosedObjectV3(relationship["targetRef"], targetPath, []string{"kind", "worldId", "entityId"}, nil)
			if err != nil {
				return err
			}
			if err := sourceMaterializationProfileConstStringV3(target["kind"], targetPath+".kind", "worldEntity"); err != nil {
				return err
			}
			if err := sourceMaterializationProfileRequiredStringV3(target["worldId"], targetPath+".worldId"); err != nil {
				return err
			}
			if err := sourceMaterializationProfileRequiredStringV3(target["entityId"], targetPath+".entityId"); err != nil {
				return err
			}
		}
		if err := sourceMaterializationProfileStableOrderV3(stableIDs, path+".relationships"); err != nil {
			return err
		}
	}
	if child, exists := profile["capabilities"]; exists {
		capabilities, err := sourceMaterializationClosedObjectV3(child, path+".capabilities", nil, []string{"tools"})
		if err != nil {
			return err
		}
		if tools, exists := capabilities["tools"]; exists {
			items, err := sourceMaterializationArrayV3(tools, path+".capabilities.tools", 16384, true)
			if err != nil {
				return err
			}
			stableIDs := make([]string, 0, len(items))
			for index, item := range items {
				itemPath := fmt.Sprintf("%s.capabilities.tools[%d]", path, index)
				tool, err := sourceMaterializationClosedObjectV3(item, itemPath, []string{"toolId"}, []string{"name", "summary"})
				if err != nil {
					return err
				}
				stableID, err := sourceMaterializationProfileStringV3(tool["toolId"], itemPath+".toolId", true)
				if err != nil {
					return err
				}
				stableIDs = append(stableIDs, stableID)
				for _, field := range []string{"name", "summary"} {
					if err := sourceMaterializationProfileOptionalStringV3(tool, field, itemPath+"."+field, false); err != nil {
						return err
					}
				}
			}
			if err := sourceMaterializationProfileStableOrderV3(stableIDs, path+".capabilities.tools"); err != nil {
				return err
			}
		}
	}
	interaction, err := sourceMaterializationClosedObjectV3(profile["interactionProfile"], path+".interactionProfile", []string{"interactionModes"}, []string{"tone", "cadence", "scenario", "greeting", "greetingVariants", "dialogueExemplars"})
	if err != nil {
		return err
	}
	if err := sourceMaterializationProfileStringArrayV3(interaction["interactionModes"], path+".interactionProfile.interactionModes", sourceMaterializationProfileArraySemanticV3); err != nil {
		return err
	}
	for _, field := range []string{"tone", "cadence", "scenario"} {
		if err := sourceMaterializationProfileOptionalStringV3(interaction, field, path+".interactionProfile."+field, false); err != nil {
			return err
		}
	}
	if err := sourceMaterializationProfileOptionalStringV3(interaction, "greeting", path+".interactionProfile.greeting", true); err != nil {
		return err
	}
	if variants, exists := interaction["greetingVariants"]; exists {
		if err := sourceMaterializationProfileStringArrayV3(variants, path+".interactionProfile.greetingVariants", sourceMaterializationProfileArraySemanticV3); err != nil {
			return err
		}
	}
	if exemplars, exists := interaction["dialogueExemplars"]; exists {
		items, err := sourceMaterializationArrayV3(exemplars, path+".interactionProfile.dialogueExemplars", 16384, true)
		if err != nil {
			return err
		}
		stableIDs := make([]string, 0, len(items))
		for index, item := range items {
			itemPath := fmt.Sprintf("%s.interactionProfile.dialogueExemplars[%d]", path, index)
			exemplar, err := sourceMaterializationClosedObjectV3(item, itemPath, []string{"exemplarId", "character"}, []string{"user"})
			if err != nil {
				return err
			}
			stableID, err := sourceMaterializationProfileStringV3(exemplar["exemplarId"], itemPath+".exemplarId", true)
			if err != nil {
				return err
			}
			stableIDs = append(stableIDs, stableID)
			if err := sourceMaterializationProfileRequiredStringV3(exemplar["character"], itemPath+".character"); err != nil {
				return err
			}
			if err := sourceMaterializationProfileOptionalStringV3(exemplar, "user", itemPath+".user", false); err != nil {
				return err
			}
		}
		if err := sourceMaterializationProfileStableOrderV3(stableIDs, path+".interactionProfile.dialogueExemplars"); err != nil {
			return err
		}
	}
	assets, err := sourceMaterializationClosedObjectV3(profile["assets"], path+".assets", []string{"resourceRefs", "intents"}, []string{"externalRefs"})
	if err != nil {
		return err
	}
	if err := validateSourceMaterializationProfileAssetRefsV3(assets["resourceRefs"], path+".assets.resourceRefs", false); err != nil {
		return err
	}
	if err := validateSourceMaterializationProfileAssetIntentsV3(assets["intents"], path+".assets.intents"); err != nil {
		return err
	}
	if external, exists := assets["externalRefs"]; exists {
		if err := validateSourceMaterializationProfileAssetRefsV3(external, path+".assets.externalRefs", true); err != nil {
			return err
		}
	}
	authoring, err := sourceMaterializationClosedObjectV3(profile["authoring"], path+".authoring", []string{"source"}, []string{"notes", "extensions"})
	if err != nil {
		return err
	}
	if err := sourceMaterializationProfileRequiredStringV3(authoring["source"], path+".authoring.source"); err != nil {
		return err
	}
	if notes, exists := authoring["notes"]; exists {
		if err := sourceMaterializationProfileStringArrayV3(notes, path+".authoring.notes", sourceMaterializationProfileArraySemanticV3); err != nil {
			return err
		}
	}
	if extensions, exists := authoring["extensions"]; exists {
		record, ok := extensions.(map[string]any)
		if !ok {
			return sourceMaterializationSchemaErrorV3(path+".authoring.extensions", "must be an object")
		}
		for namespace, extension := range record {
			extensionPath := path + ".authoring.extensions." + namespace
			entry, err := sourceMaterializationClosedObjectV3(extension, extensionPath, []string{"extensionSchemaVersion", "namespace", "productSemantic", "fields"}, nil)
			if err != nil {
				return err
			}
			normalizedNamespace := normalizeSourceMaterializationRealmStringV3(namespace)
			if strings.TrimSpace(normalizedNamespace) == "" {
				return sourceMaterializationSchemaErrorV3(extensionPath, "namespace key must be non-empty")
			}
			registration, registered := sourceMaterializationProfileExtensionRegistrationForV3(normalizedNamespace)
			if !registered {
				return sourceMaterializationSchemaErrorV3(extensionPath, "namespace is not registered for CharacterProfileCoreV1")
			}
			entryNamespace, err := sourceMaterializationProfileStringV3(entry["namespace"], extensionPath+".namespace", true)
			if err != nil {
				return err
			}
			if normalizeSourceMaterializationRealmStringV3(entryNamespace) != normalizedNamespace {
				return sourceMaterializationSchemaErrorV3(extensionPath+".namespace", "must equal its extension key")
			}
			if err := sourceMaterializationProfileConstStringV3(entry["extensionSchemaVersion"], extensionPath+".extensionSchemaVersion", registration.schemaVersion); err != nil {
				return err
			}
			productSemantic, ok := entry["productSemantic"].(bool)
			if !ok || productSemantic != registration.productSemantic {
				return sourceMaterializationSchemaErrorV3(extensionPath+".productSemantic", "must match the registered extension policy")
			}
			fields, ok := entry["fields"].(map[string]any)
			if !ok {
				return sourceMaterializationSchemaErrorV3(extensionPath+".fields", "must be an object")
			}
			if err := validateSourceMaterializationProfileExtensionJSONV3(fields, extensionPath+".fields"); err != nil {
				return err
			}
		}
	}
	return validateSourceMaterializationProfileCoverageShapeV3(profile["profileCoverage"], path+".profileCoverage")
}
