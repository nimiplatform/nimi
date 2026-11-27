package publicappregistry

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestBrowseProjectionRoundTripOmitsAuthorityFieldsAndRejectsTampering(t *testing.T) {
	ctx := context.Background()
	descriptor := validDescriptorDocument()
	source := validMemorySource(t, testRevisionA, descriptor)
	client := &Client{source: source}
	snapshot, err := client.Load(ctx)
	if err != nil {
		t.Fatal(err)
	}
	targets, err := snapshot.ListVisible(ctx, "windows-x86_64", "windows", "x86_64")
	if err != nil || len(targets) != 1 {
		t.Fatalf("ListVisible = %+v err=%v", targets, err)
	}

	raw, rev, err := EncodeBrowseProjection(targets, "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}
	if rev != testRevisionA {
		t.Fatalf("revision = %q, want %q", rev, testRevisionA)
	}
	// Display records must not serialize selectors, download URLs, payload digests, or runtime entries.
	text := string(raw)
	for _, forbidden := range []string{"nats_v1_", "asset_url", "runtime_entry", "provenance_attestation_refs"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("browse projection leaked authority field %q in %s", forbidden, text)
		}
	}

	decoded, err := DecodeBrowseProjection(raw, "windows", "x86_64")
	if err != nil || len(decoded.Targets) != 1 {
		t.Fatalf("DecodeBrowseProjection = %+v err=%v", decoded, err)
	}
	item := decoded.Targets[0]
	if item.AppID != targets[0].AppID || item.DisplayName != targets[0].DisplayName ||
		item.Version != targets[0].Version || item.DescriptorID != targets[0].DescriptorID ||
		item.TargetID != targets[0].Target.TargetID || item.ObservedRegistryRevision != testRevisionA ||
		item.PublisherGitHubNamespace != targets[0].Publisher.GitHubNamespace ||
		item.SourceRepository != targets[0].Source.Repository ||
		item.SourceLicenseSPDXExpression != targets[0].Source.License.SPDXExpression ||
		item.AssetSize != targets[0].Target.Size ||
		item.ExecutionProfileRef != targets[0].Target.ExecutionProfileRef {
		t.Fatalf("decoded browse target lost display facts: %+v", item)
	}

	// Wrong platform fails closed.
	if _, err := DecodeBrowseProjection(raw, "macos", "arm64"); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("cross-platform browse projection accepted: %v", err)
	}

	// Unknown / tampered authority field fails closed via jsonstrict.
	var mutated map[string]any
	if err := json.Unmarshal(raw, &mutated); err != nil {
		t.Fatal(err)
	}
	list := mutated["targets"].([]any)
	first := list[0].(map[string]any)
	first["approved_target_selector"] = "nats_v1_tampered"
	tampered, _ := json.Marshal(mutated)
	if _, err := DecodeBrowseProjection(tampered, "windows", "x86_64"); !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("tampered browse projection accepted: %v", err)
	}

	// Empty public catalog encodes/decodes cleanly.
	emptyRaw, emptyRev, err := EncodeBrowseProjection(nil, "windows", "x86_64")
	if err != nil || emptyRev != "" {
		t.Fatalf("empty EncodeBrowseProjection = %q %v", emptyRev, err)
	}
	emptyDecoded, err := DecodeBrowseProjection(emptyRaw, "windows", "x86_64")
	if err != nil || len(emptyDecoded.Targets) != 0 {
		t.Fatalf("empty DecodeBrowseProjection = %+v %v", emptyDecoded, err)
	}
}
