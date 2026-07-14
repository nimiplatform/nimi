package grpcserver

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/config"
)

func checkpointProductControlDataRootProposal(profileRoot string, acceptance *config.DevKernelCheckpointAcceptance) (string, error) {
	if err := config.ValidateDevKernelCheckpointAcceptance(acceptance); err != nil {
		return "", err
	}
	if explicit := filepath.Clean(strings.TrimSpace(acceptance.DevelopmentDataRootRef)); explicit != "." && explicit != "" {
		if !filepath.IsAbs(explicit) || explicit == filepath.VolumeName(explicit)+string(filepath.Separator) {
			return "", fmt.Errorf("signed development data-root binding is invalid")
		}
		return explicit, nil
	}
	root := filepath.Clean(strings.TrimSpace(profileRoot))
	if root == "." || !filepath.IsAbs(root) || root == filepath.VolumeName(root)+string(filepath.Separator) {
		return "", fmt.Errorf("verified interactive-user profile root is required")
	}
	return filepath.Join(
		root,
		"AppData",
		"Local",
		"Nimi",
		"dev-kernel-checkpoint",
		"acceptance-runs",
		acceptance.TrialID,
		acceptance.RuntimeCandidateID,
		"Nimi",
	), nil
}
