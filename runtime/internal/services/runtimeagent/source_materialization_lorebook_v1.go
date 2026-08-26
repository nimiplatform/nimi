package runtimeagent

import (
	"strings"
	"unicode/utf8"
)

func validateLorebookTextV1(value string, maxRunes int, path string) (int, error) {
	if strings.TrimSpace(value) == "" || !utf8.ValidString(value) {
		return 0, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "%s is invalid", path)
	}
	count := utf8.RuneCountInString(value)
	if count > maxRunes {
		return 0, sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "%s exceeds %d Unicode scalar values", path, maxRunes)
	}
	return count, nil
}

func validateCharacterLorebookDeclarationV1(value sourceMaterializationCharacterLorebookDeclarationV1) error {
	total, err := validateLorebookTextV1(value.Identity, 240, "canonicalSource.lorebookDeclaration.identity")
	if err != nil {
		return err
	}
	if value.Behavior == nil || len(value.Behavior) < 1 || len(value.Behavior) > 6 ||
		value.Speaking == nil || len(value.Speaking) < 1 || len(value.Speaking) > 4 ||
		value.ImmutableBoundaries == nil || len(value.ImmutableBoundaries) < 1 || len(value.ImmutableBoundaries) > 6 ||
		value.RelationshipPostures == nil || len(value.RelationshipPostures) > 4 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.lorebookDeclaration row counts are invalid")
	}
	for index, text := range value.Behavior {
		count, rowErr := validateLorebookTextV1(text, 160, "canonicalSource.lorebookDeclaration.behavior")
		if rowErr != nil {
			return rowErr
		}
		total += count
		_ = index
	}
	for _, text := range value.Speaking {
		count, rowErr := validateLorebookTextV1(text, 160, "canonicalSource.lorebookDeclaration.speaking")
		if rowErr != nil {
			return rowErr
		}
		total += count
	}
	for _, text := range value.ImmutableBoundaries {
		count, rowErr := validateLorebookTextV1(text, 160, "canonicalSource.lorebookDeclaration.immutableBoundaries")
		if rowErr != nil {
			return rowErr
		}
		total += count
	}
	for _, posture := range value.RelationshipPostures {
		if strings.TrimSpace(posture.TargetRef) == "" || (posture.RelationshipRef != nil && strings.TrimSpace(*posture.RelationshipRef) == "") {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.lorebookDeclaration relationship reference is invalid")
		}
		count, rowErr := validateLorebookTextV1(posture.Statement, 180, "canonicalSource.lorebookDeclaration.relationshipPostures.statement")
		if rowErr != nil {
			return rowErr
		}
		total += count
	}
	if total > 3600 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "canonicalSource.lorebookDeclaration exceeds 3600 Unicode scalar values")
	}
	return nil
}

func validateWorldLorebookDeclarationV1(value sourceMaterializationWorldLorebookDeclarationV1) error {
	total, err := validateLorebookTextV1(value.IdentityBaseSetting, 320, "owningWorld.lorebookDeclaration.identityBaseSetting")
	if err != nil {
		return err
	}
	if value.WorldRules == nil || len(value.WorldRules) > 8 || value.RolePlacements == nil || len(value.RolePlacements) > 4 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "owningWorld.lorebookDeclaration row counts are invalid")
	}
	for _, rule := range value.WorldRules {
		count, rowErr := validateLorebookTextV1(rule.Statement, 180, "owningWorld.lorebookDeclaration.worldRules.statement")
		if rowErr != nil {
			return rowErr
		}
		for _, ref := range []*string{rule.SystemRef, rule.PrincipleRef, rule.EvidenceRef} {
			if ref != nil && strings.TrimSpace(*ref) == "" {
				return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "owningWorld.lorebookDeclaration world rule reference is invalid")
			}
		}
		total += count
	}
	for _, placement := range value.RolePlacements {
		count, rowErr := validateLorebookTextV1(placement.Statement, 160, "owningWorld.lorebookDeclaration.rolePlacements.statement")
		if rowErr != nil {
			return rowErr
		}
		if placement.RoleRef != nil && strings.TrimSpace(*placement.RoleRef) == "" {
			return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "owningWorld.lorebookDeclaration role reference is invalid")
		}
		total += count
	}
	if total > 2400 {
		return sourceMaterializationV3Error(sourceMaterializationFailurePacketContractV3, "owningWorld.lorebookDeclaration exceeds 2400 Unicode scalar values")
	}
	return nil
}
