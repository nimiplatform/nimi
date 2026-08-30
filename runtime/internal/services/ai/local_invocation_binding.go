package ai

import (
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func projectInvocationExactBindings(values []localexecution.ExactBinding) []capabilitydriver.InvocationExactBinding {
	bindings := make([]capabilitydriver.InvocationExactBinding, 0, len(values))
	for _, binding := range values {
		bindings = append(bindings, capabilitydriver.InvocationExactBinding{
			RequirementID:     strings.TrimSpace(binding.RequirementID),
			ModelAssetID:      strings.TrimSpace(binding.ModelAssetID),
			AbsolutePath:      strings.TrimSpace(binding.AbsolutePath),
			BundleDir:         strings.TrimSpace(binding.BundleDir),
			DeclaredFiles:     append([]string(nil), binding.DeclaredFiles...),
			VerifiedContentID: strings.TrimSpace(binding.VerifiedContentID),
			EntrySHA256:       strings.TrimSpace(binding.EntrySHA256),
			TemplateIdentity:  strings.TrimSpace(binding.TemplateIdentity),
		})
	}
	return bindings
}

func projectLocalTextBehaviorAdapterMatchFacts(selected *localexecution.SelectedLocalExecution) capabilitydriver.TextBehaviorAdapterMatchFacts {
	if selected == nil || selected.DriverIdentity == nil {
		return capabilitydriver.TextBehaviorAdapterMatchFacts{}
	}
	result := capabilitydriver.TextBehaviorAdapterMatchFacts{
		RecipeID:       strings.TrimSpace(selected.RecipeID),
		RecipeRevision: strings.TrimSpace(selected.RecipeRevision),
		DriverDialect:  strings.TrimSpace(selected.DriverIdentity.GetDriverDialect()),
	}
	for _, binding := range selected.ExactBindings {
		if strings.TrimSpace(binding.RequirementID) != capabilitydriver.MainGGUFRequirementID {
			continue
		}
		result.ModelAssetID = strings.TrimSpace(binding.ModelAssetID)
		result.VerifiedContentID = strings.TrimSpace(binding.VerifiedContentID)
		result.EntrySHA256 = strings.TrimSpace(binding.EntrySHA256)
		result.TemplateIdentity = strings.TrimSpace(binding.TemplateIdentity)
		break
	}
	return result
}
