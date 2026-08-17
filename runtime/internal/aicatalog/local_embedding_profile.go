package catalog

import (
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/aicapabilities"
)

// ResolveLocalEmbeddingProfileForContent maps one exact catalog variant
// content identity to the catalog-owned embedding model and output dimension.
// Local embedding Drivers currently admit one GGUF model file, so a multi-file
// offer is deliberately not inferred here.
func (r *Resolver) ResolveLocalEmbeddingProfileForContent(contentID string) (string, int32, bool) {
	contentID = strings.ToLower(strings.TrimSpace(contentID))
	if r == nil || !strings.HasPrefix(contentID, "sha256:") || len(contentID) != len("sha256:")+64 {
		return "", 0, false
	}

	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.globalState == nil || r.globalState.snapshot == nil {
		return "", 0, false
	}
	models := r.globalState.snapshot.models["local"]
	ids := make([]string, 0, len(models))
	for id := range models {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		iAlias := strings.Contains(ids[i], "/")
		jAlias := strings.Contains(ids[j], "/")
		if iAlias != jAlias {
			return !iAlias
		}
		return ids[i] < ids[j]
	})
	for _, id := range ids {
		model := models[id]
		if model.Embedding == nil || model.Embedding.Dimension <= 0 || !containsCatalogCapability(model.Capabilities, aicapabilities.TextEmbed) {
			continue
		}
		for _, variant := range model.Variants {
			if len(variant.Files) != 1 || len(variant.Hashes) != 1 {
				continue
			}
			file := strings.TrimSpace(variant.Files[0])
			if file == "" || strings.ToLower(strings.TrimSpace(variant.Hashes[file])) != contentID {
				continue
			}
			return strings.TrimSpace(model.ModelID), int32(model.Embedding.Dimension), true
		}
	}
	return "", 0, false
}

func containsCatalogCapability(values []string, expected string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == expected {
			return true
		}
	}
	return false
}
