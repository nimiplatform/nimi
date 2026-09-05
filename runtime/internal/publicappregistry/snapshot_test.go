package publicappregistry

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

const testRevisionA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const testRevisionB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

type memoryDocumentSource struct {
	revision  string
	documents map[string][]byte
	reads     []memoryDocumentRead
}

type memoryDocumentRead struct {
	revision string
	path     string
}

func (s *memoryDocumentSource) resolveMainRevision(context.Context) (string, error) {
	return s.revision, nil
}

func (s *memoryDocumentSource) readAt(_ context.Context, revision, documentPath string, _ int64) ([]byte, error) {
	s.reads = append(s.reads, memoryDocumentRead{revision: revision, path: documentPath})
	raw, ok := s.documents[documentPath]
	if !ok {
		return nil, errors.New("missing test document")
	}
	return append([]byte(nil), raw...), nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestCanonicalSnapshotResolvesOneExactApprovedTarget(t *testing.T) {
	descriptor := validDescriptorDocument()
	source := validMemorySource(t, testRevisionA, descriptor)
	client := &Client{source: source}
	snapshot, err := client.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := snapshot.Resolve(context.Background(), descriptor.Candidate.AppID, "windows-x86_64", "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Revision() != testRevisionA || resolved.RegistryRevision != testRevisionA ||
		resolved.DescriptorID != "publisher.example-app@1.2.3" || resolved.Target.AssetName != "publisher.example-app-1.2.3-windows-x86_64.nimiapp" ||
		resolved.Target.ProvenanceAttestationRefs[0] != "https://api.github.com/repos/publisher/example-app/attestations/sha256:"+strings.Repeat("d", 64) {
		t.Fatalf("resolved target = %+v", resolved)
	}
	if resolved.Selector.DescriptorID() != resolved.DescriptorID || resolved.Selector.TargetID() != "windows-x86_64" ||
		resolved.Selector.ObservedRegistryCommit() != testRevisionA {
		t.Fatalf("selector = %+v", resolved.Selector)
	}
	listed, err := snapshot.ListVisible(context.Background(), "windows-x86_64", "windows", "x86_64")
	if err != nil || len(listed) != 1 || listed[0].DescriptorID != resolved.DescriptorID {
		t.Fatalf("visible Catalog targets = %+v err=%v", listed, err)
	}
	encodedSelector, err := json.Marshal(resolved.Selector)
	if err != nil || string(encodedSelector) != "{}" {
		t.Fatalf("selector exposed caller-authorable fields: %s err=%v", encodedSelector, err)
	}
	selectorText, err := resolved.Selector.Encode()
	if err != nil {
		t.Fatal(err)
	}
	parsedSelector, err := ParseApprovedTargetSelector(selectorText)
	if err != nil || parsedSelector != resolved.Selector {
		t.Fatalf("selector round trip = %+v err=%v", parsedSelector, err)
	}
	for _, invalid := range []string{
		"", selectorText + "=", strings.ToUpper(selectorText), strings.Replace(selectorText, ".", "..", 1),
	} {
		if _, err := ParseApprovedTargetSelector(invalid); !errors.Is(err, ErrInvalidSelector) {
			t.Fatalf("invalid selector %q error = %v", invalid, err)
		}
	}
	for _, read := range source.reads {
		if read.revision != testRevisionA || strings.HasPrefix(read.path, "submissions/") {
			t.Fatalf("noncanonical snapshot read = %+v", read)
		}
	}
	resolved.AppAccess = append(resolved.AppAccess, "mutated")
	again, err := snapshot.Resolve(context.Background(), descriptor.Candidate.AppID, "windows-x86_64", "windows", "x86_64")
	if err != nil || len(again.AppAccess) != 1 || again.AppAccess[0] != "runtime.consume" {
		t.Fatalf("resolved projection leaked mutation: %+v err=%v", again.AppAccess, err)
	}
}

func TestCurrentPlatformTargetIsClosedToImplementedCatalogTargets(t *testing.T) {
	targetID, expectedOS, expectedArch, err := currentPlatformTarget("windows", "amd64")
	if err != nil || targetID != "windows-x86_64" || expectedOS != "windows" || expectedArch != "x86_64" {
		t.Fatalf("windows target = %q %q %q err=%v", targetID, expectedOS, expectedArch, err)
	}
	for _, unsupported := range [][2]string{{"windows", "386"}, {"darwin", "arm64"}, {"linux", "amd64"}} {
		if _, _, _, err := currentPlatformTarget(unsupported[0], unsupported[1]); !errors.Is(err, ErrCatalogTargetNotFound) {
			t.Fatalf("unsupported %s/%s error = %v", unsupported[0], unsupported[1], err)
		}
	}
}

func TestRevalidateProjectsPolicyBeforeStalenessAndNeverSubstitutesLatest(t *testing.T) {
	descriptor := validDescriptorDocument()
	source := validMemorySource(t, testRevisionA, descriptor)
	client := &Client{source: source}
	initial, err := client.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := initial.Resolve(context.Background(), descriptor.Candidate.AppID, "windows-x86_64", "windows", "x86_64")
	if err != nil {
		t.Fatal(err)
	}

	source.revision = testRevisionB
	index := validIndexDocument(descriptor)
	reason := "security-review-revoked"
	row := index.Apps[descriptor.Candidate.AppID]
	row.KillSwitch = KillSwitch{Active: true, Reason: &reason, Revision: 7}
	index.Apps[descriptor.Candidate.AppID] = row
	source.documents[indexDocumentPath] = mustJSON(t, index)
	_, err = client.Revalidate(context.Background(), resolved.Selector)
	var blocked *PolicyBlockedError
	if !errors.As(err, &blocked) || blocked.Reason != reason || blocked.Revision != 7 {
		t.Fatalf("policy did not win over staleness: %T %v", err, err)
	}

	row.KillSwitch = KillSwitch{Active: false, Reason: nil, Revision: 8}
	index.Apps[descriptor.Candidate.AppID] = row
	source.documents[indexDocumentPath] = mustJSON(t, index)
	if _, err := client.Revalidate(context.Background(), resolved.Selector); !errors.Is(err, ErrStaleSelection) {
		t.Fatalf("changed Registry revision was not stale: %v", err)
	}
}

func TestSnapshotRejectsLocalPointerUnknownFieldsAndCrossDocumentDrift(t *testing.T) {
	descriptor := validDescriptorDocument()
	tests := []struct {
		name   string
		mutate func(*memoryDocumentSource)
	}{
		{
			name: "submission pointer",
			mutate: func(source *memoryDocumentSource) {
				index := validIndexDocument(descriptor)
				row := index.Apps[descriptor.Candidate.AppID]
				pointer := row.LatestAdmittedReleaseByTarget["windows-x86_64"]
				pointer.Path = "submissions/publisher/publisher.example-app/1.2.3.json"
				row.LatestAdmittedReleaseByTarget["windows-x86_64"] = pointer
				index.Apps[descriptor.Candidate.AppID] = row
				source.documents[indexDocumentPath] = mustJSON(t, index)
			},
		},
		{
			name: "unknown index field",
			mutate: func(source *memoryDocumentSource) {
				raw := string(source.documents[indexDocumentPath])
				source.documents[indexDocumentPath] = []byte(strings.Replace(raw, `"schema_version":1`, `"schema_version":1,"registry_url":"file:///tmp"`, 1))
			},
		},
		{
			name: "descriptor display drift",
			mutate: func(source *memoryDocumentSource) {
				changed := descriptor
				changed.Candidate.DisplayName = "Different"
				source.documents[expectedDescriptorPath(descriptor.Candidate.AppID, descriptor.Candidate.Version)] = mustJSON(t, changed)
			},
		},
		{
			name: "duplicate target identity",
			mutate: func(source *memoryDocumentSource) {
				changed := descriptor
				changed.Candidate.Targets = append(changed.Candidate.Targets, changed.Candidate.Targets[0])
				source.documents[expectedDescriptorPath(descriptor.Candidate.AppID, descriptor.Candidate.Version)] = mustJSON(t, changed)
			},
		},
		{
			name: "duplicate JSON key",
			mutate: func(source *memoryDocumentSource) {
				raw := string(source.documents[indexDocumentPath])
				source.documents[indexDocumentPath] = []byte(strings.Replace(raw, `"schema_version":1`, `"schema_version":1,"schema_version":1`, 1))
			},
		},
		{
			name: "trailing JSON",
			mutate: func(source *memoryDocumentSource) {
				source.documents[indexDocumentPath] = append(source.documents[indexDocumentPath], []byte(` {}`)...)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := validMemorySource(t, testRevisionA, descriptor)
			test.mutate(source)
			client := &Client{source: source}
			snapshot, err := client.Load(context.Background())
			if err == nil {
				_, err = snapshot.Resolve(context.Background(), descriptor.Candidate.AppID, "windows-x86_64", "windows", "x86_64")
			}
			if !errors.Is(err, ErrInvalidRegistrySnapshot) {
				t.Fatalf("invalid Registry input error = %v", err)
			}
			for _, read := range source.reads {
				if strings.HasPrefix(read.path, "submissions/") {
					t.Fatalf("submission content was read: %+v", source.reads)
				}
			}
		})
	}
}

func TestHiddenIndexRowCannotIssueApprovedTargetSelector(t *testing.T) {
	descriptor := validDescriptorDocument()
	source := validMemorySource(t, testRevisionA, descriptor)
	index := validIndexDocument(descriptor)
	row := index.Apps[descriptor.Candidate.AppID]
	row.Visibility = "hidden"
	index.Apps[descriptor.Candidate.AppID] = row
	source.documents[indexDocumentPath] = mustJSON(t, index)
	client := &Client{source: source}
	snapshot, err := client.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := snapshot.Resolve(context.Background(), descriptor.Candidate.AppID, "windows-x86_64", "windows", "x86_64"); !errors.Is(err, ErrCatalogAppNotFound) {
		t.Fatalf("hidden App issued selector: %v", err)
	}
	listed, err := snapshot.ListVisible(context.Background(), "windows-x86_64", "windows", "x86_64")
	if err != nil || len(listed) != 0 {
		t.Fatalf("hidden App entered Catalog list: %+v err=%v", listed, err)
	}
}

func TestResolveBindsTargetToExplicitMachineTupleWithoutDerivingItsID(t *testing.T) {
	descriptor := validDescriptorDocument()
	descriptor.Candidate.Targets[0].TargetID = "windows-desktop"
	descriptor.Candidate.Targets[0].Arch = "arm64"
	descriptor.DescriptorID = descriptor.Candidate.AppID + "@" + descriptor.Candidate.Version
	source := validMemorySource(t, testRevisionA, descriptor)
	index := validIndexDocument(descriptor)
	row := index.Apps[descriptor.Candidate.AppID]
	delete(row.LatestAdmittedReleaseByTarget, "windows-x86_64")
	row.LatestAdmittedReleaseByTarget["windows-desktop"] = descriptorPointer{
		DescriptorID: descriptor.DescriptorID,
		Path:         expectedDescriptorPath(descriptor.Candidate.AppID, descriptor.Candidate.Version),
	}
	index.Apps[descriptor.Candidate.AppID] = row
	source.documents[indexDocumentPath] = mustJSON(t, index)
	source.documents[expectedDescriptorPath(descriptor.Candidate.AppID, descriptor.Candidate.Version)] = mustJSON(t, descriptor)
	client := &Client{source: source}
	snapshot, err := client.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := snapshot.Resolve(context.Background(), descriptor.Candidate.AppID, "windows-desktop", "windows", "x86_64"); !errors.Is(err, ErrCatalogTargetNotFound) {
		t.Fatalf("wrong machine tuple resolved: %v", err)
	}
	resolved, err := snapshot.Resolve(context.Background(), descriptor.Candidate.AppID, "windows-desktop", "windows", "arm64")
	if err != nil || resolved.Target.TargetID != "windows-desktop" || resolved.Target.Arch != "arm64" {
		t.Fatalf("explicit matching machine tuple did not resolve: %+v err=%v", resolved.Target, err)
	}
}

func TestReleaseAssetURLMustIdentifyOneExactTaggedAsset(t *testing.T) {
	mutations := []struct {
		name  string
		apply func(*approvedDescriptorDocument)
	}{
		{
			name: "target escapes tag",
			apply: func(value *approvedDescriptorDocument) {
				value.Candidate.Targets[0].AssetName = "evil.nimiapp"
				value.Candidate.Targets[0].AssetURL = value.Candidate.Source.Repository + "/releases/download/" + value.Candidate.Release.Tag + "/../v9.9.9/evil.nimiapp"
			},
		},
		{
			name: "target adds directory",
			apply: func(value *approvedDescriptorDocument) {
				value.Candidate.Targets[0].AssetName = "evil.nimiapp"
				value.Candidate.Targets[0].AssetURL = value.Candidate.Source.Repository + "/releases/download/" + value.Candidate.Release.Tag + "/nested/evil.nimiapp"
			},
		},
		{
			name: "aggregate encoded slash",
			apply: func(value *approvedDescriptorDocument) {
				value.Candidate.Aggregate.AssetName = "nested/aggregate.json"
				value.Candidate.Aggregate.AssetURL = value.Candidate.Source.Repository + "/releases/download/" + value.Candidate.Release.Tag + "/nested%2Faggregate.json"
			},
		},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			changed := validDescriptorDocument()
			changed.Candidate.Targets = append([]Target(nil), changed.Candidate.Targets...)
			mutation.apply(&changed)
			source := validMemorySource(t, testRevisionA, changed)
			client := &Client{source: source}
			snapshot, err := client.Load(context.Background())
			if err == nil {
				_, err = snapshot.Resolve(context.Background(), changed.Candidate.AppID, "windows-x86_64", "windows", "x86_64")
			}
			if !errors.Is(err, ErrInvalidRegistrySnapshot) {
				t.Fatalf("noncanonical Release asset URL error = %v", err)
			}
		})
	}
}

func TestCanonicalClientUsesFixedHostsExactRevisionAndRejectsRedirect(t *testing.T) {
	descriptor := validDescriptorDocument()
	documents := validDocuments(t, descriptor)
	requested := make([]string, 0)
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requested = append(requested, request.URL.String())
		if request.URL.String() == canonicalGitHubAPIBase+"/git/ref/heads/main" {
			return response(http.StatusOK, `{"ref":"refs/heads/main","object":{"type":"commit","sha":"`+testRevisionA+`"}}`), nil
		}
		prefix := canonicalRawContentBase + "/" + testRevisionA + "/"
		if !strings.HasPrefix(request.URL.String(), prefix) {
			return response(http.StatusNotFound, "missing"), nil
		}
		documentPath := strings.TrimPrefix(request.URL.String(), prefix)
		raw, ok := documents[documentPath]
		if !ok {
			return response(http.StatusNotFound, "missing"), nil
		}
		return responseBytes(http.StatusOK, raw), nil
	})
	client := &Client{source: newCanonicalGitHubSource(transport)}
	snapshot, err := client.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := snapshot.Resolve(context.Background(), descriptor.Candidate.AppID, "windows-x86_64", "windows", "x86_64"); err != nil {
		t.Fatal(err)
	}
	if source := client.source.(*canonicalGitHubSource); source.httpClient.Timeout != canonicalRequestTimeout {
		t.Fatalf("canonical timeout = %s", source.httpClient.Timeout)
	}
	for _, target := range requested[1:] {
		if strings.Contains(target, "/main/") || !strings.HasPrefix(target, canonicalRawContentBase+"/"+testRevisionA+"/") {
			t.Fatalf("document request was not exact-revision canonical raw content: %s", target)
		}
	}

	redirectClient := &Client{source: newCanonicalGitHubSource(roundTripFunc(func(*http.Request) (*http.Response, error) {
		result := response(http.StatusFound, "")
		result.Header = make(http.Header)
		result.Header.Set("Location", canonicalGitHubAPIBase+"/git/ref/heads/main")
		return result, nil
	}))}
	if _, err := redirectClient.Load(context.Background()); err == nil {
		t.Fatal("redirected canonical Registry request succeeded")
	}
	unavailableClient := &Client{source: newCanonicalGitHubSource(roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("network unavailable")
	}))}
	if _, err := unavailableClient.Load(context.Background()); !errors.Is(err, ErrRegistryUnavailable) {
		t.Fatalf("Registry transport error = %v", err)
	}
}

func TestSchemaCompilerRejectsUnregisteredRemoteReference(t *testing.T) {
	descriptor := validDescriptorDocument()
	source := validMemorySource(t, testRevisionA, descriptor)
	source.documents[descriptorSchemaPath] = []byte(`{
      "$schema":"https://json-schema.org/draft/2020-12/schema",
      "$id":"https://registry.nimi.ai/schema/approved-descriptor.schema.json",
      "$ref":"https://attacker.invalid/schema.json"
    }`)
	client := &Client{source: source}
	if _, err := client.Load(context.Background()); err == nil || !errors.Is(err, ErrInvalidRegistrySnapshot) {
		t.Fatalf("remote schema reference error = %v", err)
	}
}

func TestSchemaCompilerUsesECMAPatternRelativeReferenceAndFormatAssertions(t *testing.T) {
	source := &memoryDocumentSource{revision: testRevisionA, documents: map[string][]byte{
		commonSchemaPath: []byte(`{
      "$schema":"https://json-schema.org/draft/2020-12/schema",
      "$id":"https://registry.nimi.ai/schema/common.schema.json",
      "$defs":{
        "relativePath":{"type":"string","pattern":"^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\)(?!.*//)[A-Za-z0-9._@+/-]+$"},
        "httpsUri":{"type":"string","format":"uri","pattern":"^https://"},
        "dateTime":{"type":"string","format":"date-time"}
      }
    }`),
		indexSchemaPath: []byte(`{
      "$schema":"https://json-schema.org/draft/2020-12/schema",
      "$id":"https://registry.nimi.ai/schema/index.schema.json",
      "type":"object",
      "additionalProperties":false,
      "required":["path","url","at"],
      "properties":{
        "path":{"$ref":"common.schema.json#/$defs/relativePath"},
        "url":{"$ref":"common.schema.json#/$defs/httpsUri"},
        "at":{"$ref":"common.schema.json#/$defs/dateTime"}
      }
    }`),
		descriptorSchemaPath: mustJSON(t, minimalSchema(canonicalDescriptorID)),
	}}
	schemas, err := loadSchemas(context.Background(), source, testRevisionA)
	if err != nil {
		t.Fatal(err)
	}
	valid := []byte(`{"path":"descriptors/publisher.app/1.0.0.json","url":"https://github.com/publisher/app","at":"2026-09-04T00:00:00Z"}`)
	if err := validateSchemaDocument(schemas.index, valid); err != nil {
		t.Fatalf("representative Registry schema rejected valid input: %v", err)
	}
	for _, invalid := range [][]byte{
		[]byte(`{"path":"../escape","url":"https://github.com/publisher/app","at":"2026-09-04T00:00:00Z"}`),
		[]byte(`{"path":"descriptor.json","url":"not-a-uri","at":"2026-09-04T00:00:00Z"}`),
		[]byte(`{"path":"descriptor.json","url":"https://github.com/publisher/app","at":"not-a-date"}`),
		[]byte(`{"path":"descriptor.json","url":"https://github.com/publisher/app","at":"2026-09-04T00:00:00Z","extra":true}`),
	} {
		if err := validateSchemaDocument(schemas.index, invalid); !errors.Is(err, ErrInvalidRegistrySnapshot) {
			t.Fatalf("representative invalid Registry schema input passed: %s err=%v", invalid, err)
		}
	}
}

func TestCanonicalSourceRejectsInvalidMainIdentityAndOversizedBody(t *testing.T) {
	for _, body := range []string{
		`{"ref":"refs/heads/develop","object":{"type":"commit","sha":"` + testRevisionA + `"}}`,
		`{"ref":"refs/heads/main","object":{"type":"tag","sha":"` + testRevisionA + `"}}`,
		`{"ref":"refs/heads/main","object":{"type":"commit","sha":"ABC"}}`,
	} {
		source := &canonicalGitHubSource{httpClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return response(http.StatusOK, body), nil
		})}}
		if _, err := source.resolveMainRevision(context.Background()); !errors.Is(err, ErrInvalidRegistrySnapshot) {
			t.Fatalf("invalid main identity error = %v", err)
		}
	}

	large := strings.Repeat("x", 9)
	for _, contentLength := range []int64{int64(len(large)), -1} {
		source := &canonicalGitHubSource{httpClient: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			result := response(http.StatusOK, large)
			result.ContentLength = contentLength
			return result, nil
		})}}
		if _, err := source.readURL(context.Background(), canonicalRawContentBase+"/"+testRevisionA+"/index.json", 8, "application/json"); !errors.Is(err, ErrInvalidRegistrySnapshot) {
			t.Fatalf("oversized Registry body error = %v", err)
		}
	}
}

func validMemorySource(t *testing.T, revision string, descriptor approvedDescriptorDocument) *memoryDocumentSource {
	t.Helper()
	return &memoryDocumentSource{revision: revision, documents: validDocuments(t, descriptor)}
}

func validDocuments(t *testing.T, descriptor approvedDescriptorDocument) map[string][]byte {
	t.Helper()
	return map[string][]byte{
		commonSchemaPath:     mustJSON(t, minimalSchema(canonicalCommonSchemaID)),
		indexSchemaPath:      mustJSON(t, minimalSchema(canonicalIndexSchemaID)),
		descriptorSchemaPath: mustJSON(t, minimalSchema(canonicalDescriptorID)),
		indexDocumentPath:    mustJSON(t, validIndexDocument(descriptor)),
		expectedDescriptorPath(descriptor.Candidate.AppID, descriptor.Candidate.Version): mustJSON(t, descriptor),
	}
}

func minimalSchema(id string) map[string]any {
	return map[string]any{
		"$schema": canonicalSchemaDraftID,
		"$id":     id,
		"type":    "object",
	}
}

func validIndexDocument(descriptor approvedDescriptorDocument) registryIndexDocument {
	return registryIndexDocument{
		SchemaVersion: 1,
		Apps: map[string]registryAppRow{
			descriptor.Candidate.AppID: {
				DisplayName:     descriptor.Candidate.DisplayName,
				Visibility:      "public",
				AdmissionStatus: "approved",
				KillSwitch:      KillSwitch{Active: false, Reason: nil, Revision: 0},
				LatestAdmittedReleaseByTarget: map[string]descriptorPointer{
					"windows-x86_64": {
						DescriptorID: descriptor.DescriptorID,
						Path:         expectedDescriptorPath(descriptor.Candidate.AppID, descriptor.Candidate.Version),
					},
				},
			},
		},
	}
}

func validDescriptorDocument() approvedDescriptorDocument {
	appID := "publisher.example-app"
	version := "1.2.3"
	repository := "https://github.com/publisher/example-app"
	tag := "v" + version
	return approvedDescriptorDocument{
		SchemaVersion:       1,
		DescriptorID:        appID + "@" + version,
		PublisherSubmission: publisherSubmission{PullNumber: 7, Path: "submissions/publisher/" + appID + "/" + version + ".json", HeadSHA: testRevisionB},
		Admission: Admission{
			OrdinaryReleaseProof: true,
			TrustTier:            "community",
			BuildAssurance:       "developer-attested",
			DependencyAssurance:  DependencyAssurance{LockfileReviewed: true, SBOMRef: nil},
			Review:               Review{Decision: "approved", AdjudicatorLogin: "maintainer", AdjudicatorActorID: 42, ReasonCode: "approved-review", DecidedAt: "2026-09-04T00:00:00Z"},
		},
		Candidate: approvedCandidate{
			AppID: appID, DisplayName: "Example App", Version: version,
			Publisher: Publisher{GitHubNamespace: "publisher", NamespaceKind: "organization", Assurance: "pseudonymous"},
			Source:    Source{Repository: repository, License: SourceLicense{SPDXExpression: "MIT", Files: []LicenseFile{{Path: "LICENSE", SHA256: strings.Repeat("a", 64)}}}},
			Release:   Release{Tag: tag, TagProtectionRef: "https://api.github.com/repos/publisher/example-app/rulesets/100", CommitSHA: testRevisionB, ReleaseID: 21, ReleaseURL: repository + "/releases/tag/" + tag, ReleaseNotesURL: repository + "/releases/tag/" + tag, Immutable: true, Prerelease: false},
			Aggregate: aggregateAsset{AssetID: 100, AssetName: appID + "-" + version + ".candidate.json", AssetURL: repository + "/releases/download/" + tag + "/" + appID + "-" + version + ".candidate.json", Size: 1000, SHA256: strings.Repeat("c", 64)},
			Package:   Package{Kind: "nimiapp", RuntimeKind: "native", RegistrationMode: "app-managed", SandboxRef: "windows-current-user-v1"},
			AppAccess: []string{"runtime.consume"}, CapabilityContractRefs: []string{}, RequiredStandardizedFeatureRefs: []string{},
			StoragePolicy: StoragePolicy{Kind: "nimi-mediated-default", OSStorageDisclosure: nil},
			UpdateChannel: "stable", RollbackMarker: "none",
			Support: Support{DiagnosticsBundleFields: []string{}, RedactionRules: []string{}, IssueCategories: []string{}, EscalationURL: repository + "/issues", KillSwitchVisibility: "visible", RecoveryInstructions: "Reinstall the approved release."},
			Targets: []Target{{
				TargetID: "windows-x86_64", OS: "windows", Arch: "x86_64", AssetID: 101,
				AssetName: appID + "-" + version + "-windows-x86_64.nimiapp",
				AssetURL:  repository + "/releases/download/" + tag + "/" + appID + "-" + version + "-windows-x86_64.nimiapp",
				Size:      2000, SHA256: strings.Repeat("d", 64), RuntimeEntry: "payload/example-app.exe",
				ProvenanceAttestationRefs: []string{"https://api.github.com/repos/publisher/example-app/attestations/sha256:" + strings.Repeat("d", 64)},
				ExecutionProfileRef:       "windows-user-mode-as-invoker-v1",
				NativeTrust:               NativeTrust{WindowsCodeSigning: "unsigned", MacOSNotarization: "not-applicable"},
			}},
		},
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func response(status int, body string) *http.Response {
	return responseBytes(status, []byte(body))
}

func responseBytes(status int, body []byte) *http.Response {
	return &http.Response{
		StatusCode:    status,
		Header:        make(http.Header),
		Body:          io.NopCloser(strings.NewReader(string(body))),
		ContentLength: int64(len(body)),
	}
}
