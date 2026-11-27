// @nimi-authority: rule.nimi.runtime.local-compute.r100

package engine

import (
	"fmt"
	"slices"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

const modelContentMismatchGuidance = "re-import or repair the local model asset before retrying"

func modelContentMismatchFailure(err error) error {
	return executionFailure(localexecution.FailureContentMismatch, fmt.Errorf("%w; %s", err, modelContentMismatchGuidance))
}

// verifiedLlamaModelResidency proves that one exact live supervised llama-server
// process instance passed full captured model file set verification on Windows
// local NTFS for text.generate and has not been invalidated by exit, crash,
// restart, stop, model switch, or managed model mutation.
type verifiedLlamaModelResidency struct {
	processInstanceID    string
	supervisorInstanceID string
	processKey           string
	modelFiles           []capabilitydriver.InvocationExactBinding
	invalidationGen      uint64
}

func cloneInvocationExactBindings(bindings []capabilitydriver.InvocationExactBinding) []capabilitydriver.InvocationExactBinding {
	if len(bindings) == 0 {
		return nil
	}
	cloned := make([]capabilitydriver.InvocationExactBinding, len(bindings))
	for index, binding := range bindings {
		cloned[index] = binding
		if len(binding.DeclaredFiles) > 0 {
			cloned[index].DeclaredFiles = append([]string(nil), binding.DeclaredFiles...)
		}
	}
	return cloned
}

func equalInvocationModelFiles(left []capabilitydriver.InvocationExactBinding, right []capabilitydriver.InvocationExactBinding) bool {
	if len(left) == 0 || len(left) != len(right) {
		return false
	}
	for index := range left {
		a := left[index]
		b := right[index]
		if a.RequirementID != b.RequirementID ||
			a.ModelAssetID != b.ModelAssetID ||
			a.AbsolutePath != b.AbsolutePath ||
			a.BundleDir != b.BundleDir ||
			!strings.EqualFold(strings.TrimSpace(a.VerifiedContentID), strings.TrimSpace(b.VerifiedContentID)) ||
			!strings.EqualFold(strings.TrimSpace(a.EntrySHA256), strings.TrimSpace(b.EntrySHA256)) ||
			!slices.Equal(a.DeclaredFiles, b.DeclaredFiles) {
			return false
		}
	}
	return true
}

func modelFilesReferenceAsset(bindings []capabilitydriver.InvocationExactBinding, modelAssetID string) bool {
	trimmed := strings.TrimSpace(modelAssetID)
	if trimmed == "" {
		return false
	}
	for _, binding := range bindings {
		if strings.TrimSpace(binding.ModelAssetID) == trimmed {
			return true
		}
	}
	return false
}

// llamaTextProcessArgsAllowWarmSkip guards against any llama-server launch
// mode that may dynamically load or reopen model weights or adapters after
// startup (router mode, dynamic LoRA, control vectors, or embedding/reranking
// modes). Such branches retain full per-invocation re-verification.
func llamaTextProcessArgsAllowWarmSkip(args []string) bool {
	if len(args) == 0 {
		return false
	}
	for _, raw := range args {
		flag := strings.ToLower(strings.TrimSpace(raw))
		if idx := strings.IndexByte(flag, '='); idx >= 0 {
			flag = flag[:idx]
		}
		switch flag {
		case "--embedding", "--embeddings", "--reranking",
			"--models-dir", "--models-preset",
			"--lora", "--lora-scaled", "--lora-init-without-apply",
			"--control-vector", "--control-vector-scaled":
			return false
		}
	}
	return true
}
