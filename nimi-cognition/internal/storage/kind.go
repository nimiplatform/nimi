package storage

import (
	"fmt"
	"strings"

	scopepkg "github.com/nimiplatform/nimi/nimi-cognition/internal/scope"
)

// ArtifactKind identifies which durable cognition family a stored item belongs to.
type ArtifactKind string

const (
	KindKernel    ArtifactKind = "kernels"
	KindMemory    ArtifactKind = "memory"
	KindKnowledge ArtifactKind = "knowledge"
	KindSkill     ArtifactKind = "skills"
	KindCommit    ArtifactKind = "commits"
)

func validateScopeID(scopeID string) error {
	if err := scopepkg.Validate(scopeID); err != nil {
		return fmt.Errorf("storage: %w", err)
	}
	return nil
}

func validateArtifactKind(kind ArtifactKind) error {
	switch kind {
	case KindKernel, KindMemory, KindKnowledge, KindSkill, KindCommit:
		return nil
	case "":
		return fmt.Errorf("storage: artifact kind is required")
	default:
		return fmt.Errorf("storage: invalid artifact kind %q", kind)
	}
}

func validateItemID(itemID string) error {
	trimmed := strings.TrimSpace(itemID)
	switch trimmed {
	case "", ".", "..":
		return fmt.Errorf("storage: item id is required")
	}
	if strings.ContainsAny(trimmed, `/\`) {
		return fmt.Errorf("storage: invalid item id %q", itemID)
	}
	return nil
}
