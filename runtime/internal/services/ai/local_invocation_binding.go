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
		})
	}
	return bindings
}
