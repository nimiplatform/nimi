package catalog

import (
	"strings"
	"testing"
)

func videoBlock(modes []string, roles map[string][]string) *VideoGenerationCapability {
	video := &VideoGenerationCapability{
		Modes:      modes,
		InputRoles: roles,
		Limits:     map[string]any{"max_duration_seconds": 10},
		Options: VideoGenerationOptions{
			Supports:    []string{"duration"},
			Constraints: map[string]any{"duration": []int{5, 10}},
		},
		Outputs: VideoGenerationOutputs{VideoURL: true},
	}
	return video
}

// rule.nimi.runtime.model-catalog.r026: modes are a non-empty subset of the
// closed canonical set, and every declared mode carries its role coverage.
// These cases pin the loader to that contract so a catalog row drifting
// outside it fails at load instead of shipping as inferred capability.
func TestVideoModesMustBeCanonicalSubsetWithCoverage(t *testing.T) {
	valid := videoBlock(
		[]string{"t2v", "i2v_first_frame"},
		map[string][]string{"t2v": {"prompt"}, "i2v_first_frame": {"prompt", "first_frame"}},
	)
	if err := validateVideoGenerationCapability("p", "m", valid); err != nil {
		t.Fatalf("declared canonical subset with coverage must pass: %v", err)
	}

	duplicate := videoBlock(
		[]string{"t2v", "t2v"},
		map[string][]string{"t2v": {"prompt"}},
	)
	if err := validateVideoGenerationCapability("p", "m", duplicate); err == nil || !strings.Contains(err.Error(), "duplicate mode") {
		t.Fatalf("a duplicate mode must fail, got %v", err)
	}

	nonCanonical := videoBlock(
		[]string{"t2v", "loop_video"},
		map[string][]string{"t2v": {"prompt"}, "loop_video": {"prompt"}},
	)
	if err := validateVideoGenerationCapability("p", "m", nonCanonical); err == nil || !strings.Contains(err.Error(), "non-canonical mode") {
		t.Fatalf("a mode outside the canonical set must fail, got %v", err)
	}

	missingRoles := videoBlock(
		[]string{"t2v", "i2v_first_frame"},
		map[string][]string{"t2v": {"prompt"}},
	)
	if err := validateVideoGenerationCapability("p", "m", missingRoles); err == nil || !strings.Contains(err.Error(), "missing declared mode") {
		t.Fatalf("a declared mode without input roles must fail, got %v", err)
	}

	orphanRoles := videoBlock(
		[]string{"t2v"},
		map[string][]string{"t2v": {"prompt"}, "i2v_reference": {"prompt", "reference"}},
	)
	if err := validateVideoGenerationCapability("p", "m", orphanRoles); err == nil || !strings.Contains(err.Error(), "undeclared mode") {
		t.Fatalf("input roles for an undeclared mode must fail, got %v", err)
	}
}
