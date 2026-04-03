package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

type probeOutput struct {
	Path                               string            `json:"path"`
	Magic                              string            `json:"magic"`
	Version                            uint32            `json:"version"`
	TensorCount                        uint64            `json:"tensor_count"`
	KVCount                            uint64            `json:"kv_count"`
	Keys                               []string          `json:"keys"`
	TensorNameSample                   []string          `json:"tensor_name_sample,omitempty"`
	StringValues                       map[string]string `json:"string_values,omitempty"`
	StableDiffusionIdentityKeysPresent []string          `json:"stable_diffusion_identity_keys_present"`
	StableDiffusionVersionKeysPresent  []string          `json:"stable_diffusion_version_keys_present"`
	StableDiffusionTensorSignatures    []string          `json:"stable_diffusion_tensor_signatures,omitempty"`
	StableDiffusionDetectedFamily      string            `json:"stable_diffusion_detected_family,omitempty"`
	StableDiffusionMetadataIssue       string            `json:"stable_diffusion_metadata_issue,omitempty"`
}

func main() {
	var path string
	flag.StringVar(&path, "path", "", "path to a GGUF file")
	flag.Parse()

	path = strings.TrimSpace(path)
	if path == "" {
		fmt.Fprintln(os.Stderr, "ggufprobe failed: --path is required")
		os.Exit(2)
	}

	summary, err := ggufmeta.InspectPath(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ggufprobe failed: %v\n", err)
		os.Exit(1)
	}

	out := probeOutput{
		Path:                               path,
		Magic:                              summary.Magic,
		Version:                            summary.Version,
		TensorCount:                        summary.TensorCount,
		KVCount:                            summary.KVCount,
		Keys:                               summary.Keys(),
		TensorNameSample:                   tensorNameSample(summary, 16),
		StableDiffusionIdentityKeysPresent: ggufmeta.StableDiffusionIdentityKeysPresent(summary),
		StableDiffusionVersionKeysPresent:  ggufmeta.StableDiffusionVersionKeysPresent(summary),
		StableDiffusionTensorSignatures:    ggufmeta.StableDiffusionTensorSignaturesPresent(summary),
		StableDiffusionDetectedFamily:      ggufmeta.StableDiffusionDetectedFamily(summary),
		StableDiffusionMetadataIssue:       ggufmeta.StableDiffusionMetadataIssue(summary),
	}
	if values := stringValues(summary); len(values) > 0 {
		out.StringValues = values
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "ggufprobe failed: %v\n", err)
		os.Exit(1)
	}
}

func stringValues(summary ggufmeta.Summary) map[string]string {
	values := make(map[string]string)
	for _, entry := range summary.Entries {
		if entry.HasStringValue {
			values[entry.Key] = entry.StringValue
		}
	}
	if len(values) == 0 {
		return nil
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	ordered := make(map[string]string, len(keys))
	for _, key := range keys {
		ordered[key] = values[key]
	}
	return ordered
}

func tensorNameSample(summary ggufmeta.Summary, limit int) []string {
	if limit <= 0 || len(summary.TensorNames) == 0 {
		return nil
	}
	if len(summary.TensorNames) <= limit {
		return append([]string(nil), summary.TensorNames...)
	}
	return append([]string(nil), summary.TensorNames[:limit]...)
}
