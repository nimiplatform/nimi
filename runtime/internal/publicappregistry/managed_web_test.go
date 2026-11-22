package publicappregistry

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validManagedWebDescriptor(version string) approvedDescriptorDocument {
	doc := validDescriptorDocument()
	appID := doc.Candidate.AppID
	tag := "v" + version
	repository := doc.Candidate.Source.Repository
	doc.DescriptorID = appID + "@" + version
	doc.Candidate.Version = version
	doc.Candidate.Release.Tag = tag
	doc.Candidate.Release.ReleaseURL = repository + "/releases/tag/" + tag
	doc.Candidate.Release.ReleaseNotesURL = repository + "/releases/tag/" + tag
	doc.Candidate.Aggregate.AssetName = appID + "-" + version + ".candidate.json"
	doc.Candidate.Aggregate.AssetURL = repository + "/releases/download/" + tag + "/" + doc.Candidate.Aggregate.AssetName
	doc.Candidate.Package = Package{
		Kind:             "nimiapp",
		RuntimeKind:      "managed-web",
		RegistrationMode: "app-managed",
		SandboxRef:       "nimi-managed-web-v1",
	}
	doc.Candidate.StoragePolicy = StoragePolicy{Kind: "nimi-mediated-default"}
	assetName := appID + "-" + version + "-" + ManagedWebTargetID + ".nimiapp"
	infoName := appID + "-" + version + "-" + ManagedWebTargetID + ".app-info.json"
	doc.Candidate.Targets = []Target{{
		TargetID:            ManagedWebTargetID,
		OS:                  "any",
		Arch:                "any",
		AssetName:           assetName,
		AssetURL:            repository + "/releases/download/" + tag + "/" + assetName,
		AssetID:             201,
		Size:                2048,
		SHA256:              strings.Repeat("b", 64),
		RuntimeEntry:        ManagedWebRuntimeEntry,
		ExecutionProfileRef: ManagedWebExecutionProfileRef,
		AppInfo: AppInfoAsset{
			AssetName: infoName,
			AssetURL:  repository + "/releases/download/" + tag + "/" + infoName,
			AssetID:   202,
			Size:      512,
			SHA256:    strings.Repeat("c", 64),
		},
		NativeTrust: NativeTrust{
			WindowsCodeSigning: "not-applicable",
			MacOSNotarization:  "not-applicable",
		},
		ProvenanceAttestationRefs: []string{
			"https://api.github.com/repos/publisher/example-app/attestations/sha256:" + strings.Repeat("d", 64),
		},
	}}
	return doc
}

func TestManagedWebDescriptorResolvesOnBothPlatformsAndWinsHigherSemVer(t *testing.T) {
	nativeDoc := validDescriptorDocument() // version 1.2.3, windows-x86_64
	managedDoc := validManagedWebDescriptor("1.2.4")

	index := validIndexDocument(nativeDoc)
	row := index.Apps[nativeDoc.Candidate.AppID]
	row.LatestAdmittedReleaseByTarget[ManagedWebTargetID] = descriptorPointer{
		DescriptorID: managedDoc.DescriptorID,
		Path:         expectedDescriptorPath(managedDoc.Candidate.AppID, managedDoc.Candidate.Version),
	}
	index.Apps[nativeDoc.Candidate.AppID] = row

	documents := validDocuments(t, nativeDoc)
	documents[indexDocumentPath] = mustJSON(t, index)
	documents[expectedDescriptorPath(managedDoc.Candidate.AppID, managedDoc.Candidate.Version)] = mustJSON(t, managedDoc)

	source := &memoryDocumentSource{revision: testRevisionA, documents: documents}
	client := &Client{source: source}
	snapshot, err := client.Load(context.Background())
	if err != nil {
		t.Fatalf("Load mixed native+managed-web snapshot: %v", err)
	}

	winListed, err := snapshot.ListVisible(context.Background(), "windows-x86_64", "windows", "x86_64")
	if err != nil || len(winListed) != 1 || winListed[0].Version != "1.2.4" || winListed[0].Target.TargetID != ManagedWebTargetID {
		t.Fatalf("Windows ListVisible = %+v, err=%v", winListed, err)
	}

	macListed, err := snapshot.ListVisible(context.Background(), "macos-aarch64", "macos", "arm64")
	if err != nil || len(macListed) != 1 || macListed[0].Version != "1.2.4" || macListed[0].Target.TargetID != ManagedWebTargetID {
		t.Fatalf("macOS ListVisible = %+v, err=%v", macListed, err)
	}

	resolved, err := snapshot.Resolve(context.Background(), managedDoc.Candidate.AppID, ManagedWebTargetID, "windows", "x86_64")
	if err != nil || resolved.Version != "1.2.4" || resolved.Package.RuntimeKind != "managed-web" {
		t.Fatalf("Resolve managed-web on windows = %+v, err=%v", resolved, err)
	}
}

func TestManagedWebRejectsCrossCarrierLeakage(t *testing.T) {
	badManaged := validManagedWebDescriptor("1.2.4")
	badManaged.Candidate.StoragePolicy = StoragePolicy{
		Kind: "app-owned-os-storage",
		OSStorageDisclosure: []StorageDisclosure{{
			PathPattern: "~/data", Purpose: "db", ExpectedSizeBand: "small",
		}},
	}
	if err := validateCandidateFacts(badManaged.Candidate); err == nil {
		t.Fatal("managed-web with app-owned-os-storage accepted")
	}

	badNative := validDescriptorDocument()
	badNative.Candidate.Targets[0].TargetID = ManagedWebTargetID
	badNative.Candidate.Targets[0].OS = "any"
	badNative.Candidate.Targets[0].Arch = "any"
	if err := validateCandidateFacts(badNative.Candidate); err == nil {
		t.Fatal("native with desktop-universal accepted")
	}
}

func TestRegistryRealThreeBranchSchemaCompilesAndValidatesBothCarriers(t *testing.T) {
	schemaDir := filepath.Clean(filepath.Join("..", "..", "..", "..", "nimi-app-registry", "schema"))
	commonRaw, err := os.ReadFile(filepath.Join(schemaDir, "common.schema.json"))
	if err != nil {
		t.Skipf("sibling nimi-app-registry schema unavailable at %s: %v", schemaDir, err)
	}
	indexRaw, err := os.ReadFile(filepath.Join(schemaDir, "index.schema.json"))
	if err != nil {
		t.Fatalf("read index.schema.json: %v", err)
	}
	descriptorRaw, err := os.ReadFile(filepath.Join(schemaDir, "approved-descriptor.schema.json"))
	if err != nil {
		t.Fatalf("read approved-descriptor.schema.json: %v", err)
	}

	source := &memoryDocumentSource{
		revision: testRevisionA,
		documents: map[string][]byte{
			commonSchemaPath:     commonRaw,
			indexSchemaPath:      indexRaw,
			descriptorSchemaPath: descriptorRaw,
		},
	}
	schemas, err := loadSchemas(context.Background(), source, testRevisionA)
	if err != nil {
		t.Fatalf("Go jsonschema/v6 failed to compile real 3-branch Registry schemas: %v", err)
	}

	nativeDoc := validDescriptorDocument()
	if err := validateSchemaDocument(schemas.descriptor, mustJSON(t, nativeDoc)); err != nil {
		t.Fatalf("native descriptor failed real schema: %v", err)
	}

	managedDoc := validManagedWebDescriptor("1.2.4")
	if err := validateSchemaDocument(schemas.descriptor, mustJSON(t, managedDoc)); err != nil {
		t.Fatalf("managed-web descriptor failed real schema: %v", err)
	}

	indexDoc := validIndexDocument(managedDoc)
	row := indexDoc.Apps[managedDoc.Candidate.AppID]
	row.Origin = "community"
	indexDoc.Apps[managedDoc.Candidate.AppID] = row
	if err := validateSchemaDocument(schemas.index, mustJSON(t, indexDoc)); err != nil {
		t.Fatalf("managed-web index failed real schema: %v", err)
	}

	badStorage := validManagedWebDescriptor("1.2.4")
	badStorage.Candidate.StoragePolicy = StoragePolicy{
		Kind: "app-owned-os-storage",
		OSStorageDisclosure: []StorageDisclosure{{
			PathPattern: "~/data", Purpose: "db", ExpectedSizeBand: "small",
		}},
	}
	if err := validateSchemaDocument(schemas.descriptor, mustJSON(t, badStorage)); err == nil {
		t.Fatal("real schema accepted managed-web with app-owned-os-storage")
	}

	badNative := validDescriptorDocument()
	badNative.Candidate.Targets = validManagedWebDescriptor("1.2.3").Candidate.Targets
	if err := validateSchemaDocument(schemas.descriptor, mustJSON(t, badNative)); err == nil {
		t.Fatal("real schema accepted native with desktop-universal target")
	}

	badTrust := validManagedWebDescriptor("1.2.4")
	badTrust.Candidate.Targets[0].NativeTrust.WindowsCodeSigning = "unsigned"
	if err := validateSchemaDocument(schemas.descriptor, mustJSON(t, badTrust)); err == nil {
		t.Fatal("real schema accepted managed-web with unsigned windows_code_signing")
	}
}
