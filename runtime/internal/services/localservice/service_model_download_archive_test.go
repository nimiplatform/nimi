package localservice

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

type releaseArchiveFixture struct {
	payload  []byte
	files    map[string][]byte
	archive  *managedModelArchiveSource
	repo     string
	revision string
}

func newReleaseArchiveFixture(t *testing.T) releaseArchiveFixture {
	t.Helper()
	files := map[string][]byte{
		"config.cfg":         []byte("[nlp]\nlang = \"en\"\n"),
		"meta.json":          []byte(`{"lang":"en","name":"core_web_md","version":"3.8.0"}`),
		"vocab/strings.json": bytes.Repeat([]byte("token "), 4096),
		"LICENSE":            []byte("MIT License\n"),
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	write := func(name string, data []byte) {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create archive entry %s: %v", name, err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatalf("write archive entry %s: %v", name, err)
		}
	}
	write("pkg/__init__.py", []byte("raise SystemExit('never imported')\n"))
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		write("pkg/pkg-1.0/"+name, files[name])
	}
	write("pkg/pkg-1.0/README.md", []byte("not a declared payload\n"))
	if err := writer.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	sum := sha256.Sum256(archive.Bytes())
	return releaseArchiveFixture{
		payload: archive.Bytes(),
		files:   files,
		archive: &managedModelArchiveSource{
			file: "pkg-1.0-py3-none-any.whl", format: "zip", sha256: "sha256:" + hex.EncodeToString(sum[:]),
			sizeBytes: int64(archive.Len()), root: "pkg/pkg-1.0",
		},
		repo:     "example/models",
		revision: "pkg-1.0",
	}
}

func (fixture releaseArchiveFixture) spec(modelID string) managedDownloadedModelSpec {
	names := make([]string, 0, len(fixture.files))
	hashes := make(map[string]string, len(fixture.files))
	var total int64
	for name, data := range fixture.files {
		names = append(names, name)
		sum := sha256.Sum256(data)
		hashes[name] = "sha256:" + hex.EncodeToString(sum[:])
		total += int64(len(data))
	}
	sort.Strings(names)
	return managedDownloadedModelSpec{
		modelID: modelID, displayName: modelID, kind: runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_AUXILIARY,
		entry: "config.cfg", files: names, hashes: hashes, totalSizeBytes: total, license: "MIT",
		repo: fixture.repo, revision: fixture.revision, archive: cloneManagedModelArchiveSource(fixture.archive),
	}
}

func (fixture releaseArchiveFixture) server(t *testing.T, requests *int64, rangeStart *int64) *httptest.Server {
	t.Helper()
	wantPath := "/" + fixture.repo + "/releases/download/" + fixture.revision + "/" + fixture.archive.file
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, wantPath, http.StatusFound)
			return
		}
		if r.URL.Path != wantPath {
			http.NotFound(w, r)
			return
		}
		if requests != nil {
			atomic.AddInt64(requests, 1)
		}
		if rangeStart != nil {
			if header := strings.TrimSpace(r.Header.Get("Range")); header != "" {
				start, err := strconv.ParseInt(strings.TrimSuffix(strings.TrimPrefix(header, "bytes="), "-"), 10, 64)
				if err == nil {
					atomic.StoreInt64(rangeStart, start)
				}
			}
		}
		serveModelWithRange(w, r, fixture.payload)
	}))
	t.Cleanup(server.Close)
	return server
}

func TestInstallManagedReleaseArchiveExtractsOnlyDeclaredFiles(t *testing.T) {
	svc := newTestService(t)
	fixture := newReleaseArchiveFixture(t)
	var requests int64
	svc.githubReleaseDownloadBaseURL = fixture.server(t, &requests, nil).URL
	spec := fixture.spec("example/pkg-1.0")

	record, transferID, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
	if err != nil {
		t.Fatalf("install release archive: %v", err)
	}
	if record.GetEntry() != "config.cfg" || len(record.GetFiles()) != len(fixture.files) || record.GetTotalSizeBytes() != spec.totalSizeBytes {
		t.Fatalf("installed distribution = entry %q files %d total %d", record.GetEntry(), len(record.GetFiles()), record.GetTotalSizeBytes())
	}
	for _, file := range record.GetFiles() {
		sum := sha256.Sum256(fixture.files[file.GetRelativePath()])
		if file.GetSha256() != hex.EncodeToString(sum[:]) || file.GetSizeBytes() != int64(len(fixture.files[file.GetRelativePath()])) {
			t.Fatalf("installed file %s = %s/%d", file.GetRelativePath(), file.GetSha256(), file.GetSizeBytes())
		}
	}
	provenance := record.GetProvenance().GetFields()
	if provenance["source_archive"].GetStringValue() != fixture.archive.file || provenance["source_archive_sha256"].GetStringValue() != fixture.archive.sha256 ||
		provenance["source_archive_root"].GetStringValue() != fixture.archive.root || provenance["source_revision"].GetStringValue() != fixture.revision {
		t.Fatalf("archive provenance = %v", provenance)
	}
	directory := svc.modelAssetDirectories[record.GetModelAssetId()]
	for _, undeclared := range []string{"README.md", "__init__.py", managedModelArchiveStageDirName} {
		if _, err := os.Lstat(filepath.Join(directory, undeclared)); !os.IsNotExist(err) {
			t.Fatalf("undeclared archive content %q reached the ModelAsset view: %v", undeclared, err)
		}
	}
	extracted, err := os.ReadFile(filepath.Join(directory, "vocab", "strings.json"))
	if err != nil || !bytes.Equal(extracted, fixture.files["vocab/strings.json"]) {
		t.Fatalf("extracted nested file mismatch: err=%v", err)
	}
	transfer := svc.localTransferSummary(transferID)
	if transfer.GetState() != localTransferStateCompleted || transfer.GetBytesReceived() != fixture.archive.sizeBytes ||
		transfer.GetBytesTotal() != fixture.archive.sizeBytes || transfer.GetBytesReused() != 0 {
		t.Fatalf("archive transfer = state %s received %d total %d reused %d", transfer.GetState(), transfer.GetBytesReceived(), transfer.GetBytesTotal(), transfer.GetBytesReused())
	}
	if _, err := os.Stat(managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), transferID)); !os.IsNotExist(err) {
		t.Fatalf("archive staging still exists: %v", err)
	}
	if got := atomic.LoadInt64(&requests); got != 1 {
		t.Fatalf("archive requests = %d, want 1", got)
	}

	// Every object is published now: another distribution over the same files
	// reuses them without fetching the archive again.
	again := fixture.spec("example/pkg-1.0-meta-entry")
	again.entry = "meta.json"
	second, secondTransferID, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), again, "")
	if err != nil {
		t.Fatalf("reinstall over published objects: %v", err)
	}
	if second.GetModelAssetId() == record.GetModelAssetId() {
		t.Fatalf("different entry reused the first distribution")
	}
	secondTransfer := svc.localTransferSummary(secondTransferID)
	if got := atomic.LoadInt64(&requests); got != 1 || secondTransfer.GetBytesReceived() != 0 || secondTransfer.GetBytesReused() != spec.totalSizeBytes || secondTransfer.GetBytesTotal() != spec.totalSizeBytes {
		t.Fatalf("object reuse fetched %d archives; transfer received %d reused %d total %d", got, secondTransfer.GetBytesReceived(), secondTransfer.GetBytesReused(), secondTransfer.GetBytesTotal())
	}
}

func TestInstallManagedReleaseArchiveFailsClosedOnIntegrity(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*managedDownloadedModelSpec)
		reason runtimev1.ReasonCode
	}{
		{"archive digest", func(spec *managedDownloadedModelSpec) {
			spec.archive.sha256 = "sha256:" + strings.Repeat("0", 64)
		}, runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_HASH_MISMATCH},
		{"archive size", func(spec *managedDownloadedModelSpec) {
			spec.archive.sizeBytes++
		}, runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_HASH_MISMATCH},
		{"extracted digest", func(spec *managedDownloadedModelSpec) {
			spec.hashes["meta.json"] = "sha256:" + strings.Repeat("1", 64)
		}, runtimev1.ReasonCode_AI_LOCAL_DOWNLOAD_HASH_MISMATCH},
		{"missing declared file", func(spec *managedDownloadedModelSpec) {
			spec.files = append(spec.files, "parser/model")
			spec.hashes["parser/model"] = "sha256:" + strings.Repeat("2", 64)
			spec.totalSizeBytes += 10
		}, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID},
		{"installed size", func(spec *managedDownloadedModelSpec) {
			spec.totalSizeBytes = 3
		}, runtimev1.ReasonCode_AI_LOCAL_MANIFEST_INVALID},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			svc := newTestService(t)
			fixture := newReleaseArchiveFixture(t)
			svc.githubReleaseDownloadBaseURL = fixture.server(t, nil, nil).URL
			svc.modelDownloadMaxAttempts = 1
			spec := fixture.spec("example/pkg-1.0-" + strings.ReplaceAll(testCase.name, " ", "-"))
			testCase.mutate(&spec)
			record, transferID, err := svc.installManagedDownloadedModelWithTransfer(context.Background(), spec, "")
			if err == nil || record != nil {
				t.Fatalf("install succeeded with bad integrity: record=%v err=%v", record, err)
			}
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != testCase.reason {
				t.Fatalf("failure reason = %v (%v), want %v: %v", reason, ok, testCase.reason, err)
			}
			if len(svc.modelAssets) != 0 {
				t.Fatalf("failed archive install committed %d assets", len(svc.modelAssets))
			}
			transfer := svc.localTransferSummary(transferID)
			if transfer.GetState() != localTransferStateFailed || transfer.GetRetryable() || transfer.GetAssetId() != "" {
				t.Fatalf("failed transfer = %+v", transfer)
			}
			if _, err := os.Stat(managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), transferID)); !os.IsNotExist(err) {
				t.Fatalf("non-retryable failure kept staging: %v", err)
			}
		})
	}
}

func TestResumeRestoredReleaseArchiveUsesItsOwnRangePrefix(t *testing.T) {
	svc := newTestService(t)
	fixture := newReleaseArchiveFixture(t)
	spec := fixture.spec("example/pkg-1.0-resume")
	transfer, err := svc.newManagedModelDownloadTransfer(localTransferMutation{
		Phase: "download", State: localTransferStateRunning, BytesTotal: fixture.archive.sizeBytes, Message: "downloading archive",
	}, spec)
	if err != nil {
		t.Fatalf("capture archive transfer: %v", err)
	}
	prefix := len(fixture.payload) / 3
	archiveDir := filepath.Join(managedModelDownloadStageDir(svc.resolvedLocalModelsPath(), transfer.GetInstallSessionId()), managedModelArchiveStageDirName)
	if err := os.MkdirAll(archiveDir, 0o755); err != nil {
		t.Fatalf("create archive staging: %v", err)
	}
	if err := os.WriteFile(filepath.Join(archiveDir, fixture.archive.file+".download"), fixture.payload[:prefix], 0o644); err != nil {
		t.Fatalf("write archive prefix: %v", err)
	}
	statePath, modelsRoot, runtimeRoot, logger := svc.stateStorePath, svc.resolvedLocalModelsPath(), svc.runtimeDataRoot, svc.logger
	svc.Close()

	restored, err := NewWithProductControlDataRoot(logger, nil, statePath, 0, modelsRoot, runtimeRoot)
	if err != nil {
		t.Fatalf("restore local service: %v", err)
	}
	defer restored.Close()
	paused := restored.localTransferSummary(transfer.GetInstallSessionId())
	if paused.GetState() != localTransferStatePaused || paused.GetBytesReceived() != int64(prefix) || paused.GetBytesTotal() != fixture.archive.sizeBytes {
		t.Fatalf("restored archive transfer = state %s received %d total %d", paused.GetState(), paused.GetBytesReceived(), paused.GetBytesTotal())
	}
	var rangeStart int64 = -1
	restored.githubReleaseDownloadBaseURL = fixture.server(t, nil, &rangeStart).URL
	if _, err := restored.ResumeLocalTransfer(context.Background(), &runtimev1.ResumeLocalTransferRequest{InstallSessionId: transfer.GetInstallSessionId()}); err != nil {
		t.Fatalf("ResumeLocalTransfer: %v", err)
	}
	waitTransferStateForTest(t, restored, transfer.GetInstallSessionId(), localTransferStateCompleted)
	if got := atomic.LoadInt64(&rangeStart); got != int64(prefix) {
		t.Fatalf("archive Range start = %d, want %d", got, prefix)
	}
	completed := restored.localTransferSummary(transfer.GetInstallSessionId())
	restored.mu.RLock()
	record := cloneModelAsset(restored.modelAssets[completed.GetAssetId()])
	restored.mu.RUnlock()
	if record == nil || len(record.GetFiles()) != len(fixture.files) || completed.GetBytesReceived() != fixture.archive.sizeBytes {
		t.Fatalf("resumed archive install = record %v transfer %+v", record, completed)
	}
}

func TestManagedModelArchiveRedirectsStayOnReleaseHosts(t *testing.T) {
	source := "https://github.com/explosion/spacy-models/releases/download/en_core_web_md-3.8.0/en_core_web_md-3.8.0-py3-none-any.whl"
	for _, target := range []string{
		"https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=x",
		"https://objects.githubusercontent.com/github-production-release-asset-2e65be/1",
		"https://github.com/explosion/spacy-models/releases/download/other",
	} {
		parsed, _ := url.Parse(target)
		if err := validateManagedModelArchiveRedirect(source, parsed); err != nil {
			t.Fatalf("redirect to %s rejected: %v", target, err)
		}
	}
	for _, target := range []string{
		"http://release-assets.githubusercontent.com/asset",
		"https://example.com/asset",
		"https://huggingface.co/explosion/asset",
	} {
		parsed, _ := url.Parse(target)
		if err := validateManagedModelArchiveRedirect(source, parsed); err == nil {
			t.Fatalf("redirect to %s was admitted", target)
		}
	}
	local, _ := url.Parse("http://127.0.0.1:8080/asset")
	if err := validateManagedModelArchiveRedirect("http://127.0.0.1:8080/redirect", local); err != nil {
		t.Fatalf("same-host redirect rejected: %v", err)
	}
	other, _ := url.Parse("http://127.0.0.1:9090/asset")
	if err := validateManagedModelArchiveRedirect("http://127.0.0.1:8080/redirect", other); err == nil {
		t.Fatal("cross-port redirect was admitted")
	}
}

func TestCanonicalReleaseArchiveSpecRejectsUnsafeShapes(t *testing.T) {
	fixture := newReleaseArchiveFixture(t)
	for name, mutate := range map[string]func(*managedDownloadedModelSpec){
		"floating revision": func(spec *managedDownloadedModelSpec) { spec.revision = "" },
		"archive path":      func(spec *managedDownloadedModelSpec) { spec.archive.file = "../pkg.whl" },
		"archive root":      func(spec *managedDownloadedModelSpec) { spec.archive.root = "/pkg" },
		"archive format":    func(spec *managedDownloadedModelSpec) { spec.archive.format = "tar" },
		"reserved staging": func(spec *managedDownloadedModelSpec) {
			spec.files = append(spec.files, managedModelArchiveStageDirName+"/x")
			spec.hashes[managedModelArchiveStageDirName+"/x"] = "sha256:" + strings.Repeat("3", 64)
		},
		"unknown installed size": func(spec *managedDownloadedModelSpec) { spec.totalSizeBytes = 0 },
	} {
		spec := fixture.spec("example/pkg")
		mutate(&spec)
		if _, err := canonicalManagedDownloadedModelSpec(spec); err == nil {
			t.Fatalf("%s: unsafe release archive spec was admitted", name)
		}
	}
	if _, err := canonicalManagedDownloadedModelSpec(fixture.spec("example/pkg")); err != nil {
		t.Fatalf("valid release archive spec rejected: %v", err)
	}
}

func TestSpacyReleaseArchiveOffersProjectPinnedSourceFacts(t *testing.T) {
	svc := newTestService(t)
	wantArchives := map[string]int64{
		"spacy-md-en": 33480380, "spacy-md-de": 44398316, "spacy-md-es": 42284033, "spacy-md-fr": 45836173,
		"spacy-md-it": 42389964, "spacy-md-ru": 41884158, "spacy-md-zh": 78021257, "spacy-md-ja": 42105500,
	}
	response, err := svc.ListLoadoutRecipes(context.Background(), &runtimev1.ListLoadoutRecipesRequest{CapabilityContract: "text.annotate"})
	if err != nil {
		t.Fatalf("ListLoadoutRecipes: %v", err)
	}
	seen := 0
	for _, recipe := range response.GetRecipes() {
		want, ok := wantArchives[recipe.GetRecipeId()]
		if !ok {
			continue
		}
		seen++
		slots := recipe.GetSlots()
		if len(slots) != 1 || len(slots[0].GetOffers()) != 1 {
			t.Fatalf("%s slots/offers = %v", recipe.GetRecipeId(), slots)
		}
		offer := slots[0].GetOffers()[0]
		candidate := offer.GetCandidate()
		if candidate.GetDownloadSizeBytes() != want || candidate.GetTotalSizeBytes() <= want || !candidate.GetInstallable() || candidate.GetLicense() == "" {
			t.Fatalf("%s candidate = download %d total %d installable %v license %q", recipe.GetRecipeId(), candidate.GetDownloadSizeBytes(), candidate.GetTotalSizeBytes(), candidate.GetInstallable(), candidate.GetLicense())
		}
		if offer.GetApplicability() != runtimev1.LocalRecommendationApplicability_LOCAL_RECOMMENDATION_APPLICABILITY_SUPPORTED {
			t.Fatalf("%s CPU offer applicability = %v", recipe.GetRecipeId(), offer.GetApplicability())
		}

		planResponse, err := svc.ResolveModelInstallPlan(context.Background(), &runtimev1.ResolveModelInstallPlanRequest{OfferRef: candidate.GetOfferRef()})
		if err != nil {
			t.Fatalf("%s ResolveModelInstallPlan: %v", recipe.GetRecipeId(), err)
		}
		plan := planResponse.GetPlan()
		archive, err := svc.catalogReleaseArchiveForPlan(plan)
		if err != nil || archive == nil || archive.sizeBytes != want || !strings.HasSuffix(archive.file, "-3.8.0-py3-none-any.whl") {
			t.Fatalf("%s plan archive = %+v err=%v", recipe.GetRecipeId(), archive, err)
		}
		spec, err := canonicalManagedDownloadedModelSpec(managedDownloadedModelSpec{
			modelID: plan.GetTemplateId(), entry: plan.GetEntry(), files: plan.GetFiles(), hashes: plan.GetHashes(),
			repo: plan.GetRepo(), revision: plan.GetRevision(), totalSizeBytes: plan.GetTotalSizeBytes(), archive: archive,
		})
		if err != nil || spec.archive == nil {
			t.Fatalf("%s catalog plan does not form a release archive spec: %v", recipe.GetRecipeId(), err)
		}
		plan.Files = append([]string(nil), plan.GetFiles()[1:]...)
		if _, err := svc.catalogReleaseArchiveForPlan(plan); err == nil {
			t.Fatalf("%s changed plan still resolved its release archive", recipe.GetRecipeId())
		}

		svc.hfDownloadBaseURL = "http://127.0.0.1:1"
		_, err = svc.GetCatalogModelCard(context.Background(), &runtimev1.GetCatalogModelCardRequest{OfferRef: candidate.GetOfferRef()})
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_LOCAL_TEMPLATE_NOT_FOUND {
			t.Fatalf("%s release archive model card = %v", recipe.GetRecipeId(), err)
		}
	}
	if seen != len(wantArchives) {
		t.Fatalf("spaCy recipes seen = %d, want %d", seen, len(wantArchives))
	}
	if errors.Is(err, context.Canceled) {
		t.Fatal("unexpected cancellation")
	}
}
