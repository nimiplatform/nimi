package app

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
)

func TestLocalAppAdoptionStoreGenerationLifecycleAndReload(t *testing.T) {
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	store := newLocalAppAdoptionStoreForTest(nimiDir)
	store.now = func() string { return "2026-07-11T00:00:00.000Z" }
	candidate := localAppAdoptionGenerationCandidate(t.TempDir(), "local.generation")

	generation, err := store.adoptionGeneration(candidate.AppID)
	if err != nil {
		t.Fatalf("read missing generation: %v", err)
	}
	if generation != 0 {
		t.Fatalf("missing generation = %d, want 0", generation)
	}

	first, err := store.commitAdoption(candidate)
	if err != nil {
		t.Fatalf("first adoption: %v", err)
	}
	if first.Generation != 1 {
		t.Fatalf("first generation = %d, want 1", first.Generation)
	}

	reAdopted, err := store.commitAdoption(candidate)
	if err != nil {
		t.Fatalf("re-adoption: %v", err)
	}
	if reAdopted.Generation != 2 {
		t.Fatalf("re-adoption generation = %d, want 2", reAdopted.Generation)
	}

	removed, err := store.remove(candidate.AppID)
	if err != nil {
		t.Fatalf("remove adoption: %v", err)
	}
	if removed.State != "removed" || removed.Generation != 3 {
		t.Fatalf("removed adoption = %#v, want state removed at generation 3", removed)
	}

	reloaded := newLocalAppAdoptionStoreForTest(nimiDir)
	generation, err = reloaded.adoptionGeneration(candidate.AppID)
	if err != nil {
		t.Fatalf("read reloaded generation: %v", err)
	}
	if generation != 3 {
		t.Fatalf("reloaded generation = %d, want 3", generation)
	}
	rows, err := reloaded.list()
	if err != nil {
		t.Fatalf("list reloaded adoptions: %v", err)
	}
	if len(rows) != 1 || rows[0].State != "removed" || rows[0].Generation != 3 {
		t.Fatalf("reloaded rows = %#v, want one retained removed row at generation 3", rows)
	}
}

func TestLocalAppAdoptionStoreGenerationRejectsStaleAndMalformedRecords(t *testing.T) {
	candidate := localAppAdoptionGenerationCandidate(t.TempDir(), "local.invalid-generation")
	candidate.State = "adopted"
	candidate.Trust = "explicit-local"
	candidate.AdoptedAt = "2026-07-11T00:00:00.000Z"
	candidate.UpdatedAt = candidate.AdoptedAt
	candidate.Generation = 1
	valid := localAppAdoptionsRecord{
		SchemaVersion: localAppAdoptionsSchemaVersion,
		UpdatedAt:     candidate.UpdatedAt,
		Adoptions:     []localAppAdoptionRecord{candidate},
	}

	tests := []struct {
		name string
		body func(t *testing.T) []byte
		want string
	}{
		{
			name: "stale schema",
			body: func(t *testing.T) []byte {
				t.Helper()
				copy := valid
				copy.SchemaVersion = 1
				return localAppAdoptionGenerationJSON(t, copy)
			},
			want: "unsupported app-adoptions.json schemaVersion=1",
		},
		{
			name: "missing generation",
			body: func(t *testing.T) []byte {
				t.Helper()
				raw := localAppAdoptionGenerationJSON(t, valid)
				return []byte(strings.Replace(string(raw), `"generation":1,`, "", 1))
			},
			want: "generation must be nonzero",
		},
		{
			name: "zero generation",
			body: func(t *testing.T) []byte {
				t.Helper()
				copy := valid
				copy.Adoptions = append([]localAppAdoptionRecord(nil), valid.Adoptions...)
				copy.Adoptions[0].Generation = 0
				return localAppAdoptionGenerationJSON(t, copy)
			},
			want: "generation must be nonzero",
		},
		{
			name: "malformed generation",
			body: func(t *testing.T) []byte {
				t.Helper()
				raw := localAppAdoptionGenerationJSON(t, valid)
				return []byte(strings.Replace(string(raw), `"generation":1`, `"generation":"one"`, 1))
			},
			want: "cannot unmarshal string",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			nimiDir := filepath.Join(t.TempDir(), ".nimi")
			path := filepath.Join(nimiDir, "runtime", "app-adoptions.json")
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatalf("create adoption directory: %v", err)
			}
			if err := os.WriteFile(path, test.body(t), 0o644); err != nil {
				t.Fatalf("write adoption record: %v", err)
			}
			_, err := newLocalAppAdoptionStoreForTest(nimiDir).adoptionGeneration(candidate.AppID)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("adoptionGeneration error = %v, want containing %q", err, test.want)
			}
		})
	}
}

func TestLocalAppAdoptionStoreGenerationOverflowDoesNotWrite(t *testing.T) {
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	store := newLocalAppAdoptionStoreForTest(nimiDir)
	store.now = func() string { return "2026-07-11T00:00:01.000Z" }
	candidate := localAppAdoptionGenerationCandidate(t.TempDir(), "local.generation-overflow")
	candidate.State = "adopted"
	candidate.Trust = "explicit-local"
	candidate.AdoptedAt = "2026-07-11T00:00:00.000Z"
	candidate.UpdatedAt = candidate.AdoptedAt
	candidate.Generation = math.MaxUint64
	path, err := store.localAppAdoptionsPath()
	if err != nil {
		t.Fatalf("resolve adoption path: %v", err)
	}
	if err := writeLocalAppAdoptionsRecord(path, localAppAdoptionsRecord{
		SchemaVersion: localAppAdoptionsSchemaVersion,
		UpdatedAt:     candidate.UpdatedAt,
		Adoptions:     []localAppAdoptionRecord{candidate},
	}); err != nil {
		t.Fatalf("seed max generation: %v", err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read seeded record: %v", err)
	}

	if _, err := store.commitAdoption(candidate); err == nil || !strings.Contains(err.Error(), "generation overflow") {
		t.Fatalf("commitAdoption error = %v, want generation overflow", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read record after rejected mutation: %v", err)
	}
	if string(after) != string(before) {
		t.Fatalf("overflow mutation changed app-adoptions.json\nbefore: %s\nafter: %s", before, after)
	}

	if _, err := store.remove(candidate.AppID); err == nil || !strings.Contains(err.Error(), "generation overflow") {
		t.Fatalf("remove error = %v, want generation overflow", err)
	}
	afterRemove, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read record after rejected remove: %v", err)
	}
	if string(afterRemove) != string(before) {
		t.Fatalf("overflow remove changed app-adoptions.json\nbefore: %s\nafter: %s", before, afterRemove)
	}
}

func TestLocalAppAdoptionStoreGenerationSerializesConcurrentMutations(t *testing.T) {
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	store := newLocalAppAdoptionStoreForTest(nimiDir)
	store.now = func() string { return "2026-07-11T00:00:00.000Z" }
	candidate := localAppAdoptionGenerationCandidate(t.TempDir(), "local.concurrent-generation")

	const mutationCount = 24
	start := make(chan struct{})
	results := make(chan uint64, mutationCount)
	errs := make(chan error, mutationCount)
	var wg sync.WaitGroup
	for range mutationCount {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			adoption, err := store.commitAdoption(candidate)
			if err != nil {
				errs <- err
				return
			}
			results <- adoption.Generation
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Errorf("concurrent commitAdoption: %v", err)
	}
	if t.Failed() {
		return
	}

	generations := make([]uint64, 0, mutationCount)
	for generation := range results {
		generations = append(generations, generation)
	}
	sort.Slice(generations, func(i, j int) bool { return generations[i] < generations[j] })
	if len(generations) != mutationCount {
		t.Fatalf("successful generations = %v, want %d", generations, mutationCount)
	}
	for index, generation := range generations {
		if want := uint64(index + 1); generation != want {
			t.Fatalf("generations = %v, want exact sequence 1..%d", generations, mutationCount)
		}
	}

	reloaded := newLocalAppAdoptionStoreForTest(nimiDir)
	generation, err := reloaded.adoptionGeneration(candidate.AppID)
	if err != nil {
		t.Fatalf("read serialized generation: %v", err)
	}
	if generation != mutationCount {
		t.Fatalf("persisted generation = %d, want %d", generation, mutationCount)
	}
}

func localAppAdoptionGenerationCandidate(root string, appID string) localAppAdoptionRecord {
	return localAppAdoptionRecord{
		AppID:              appID,
		RootPath:           root,
		ManifestPath:       filepath.Join(root, "nimi.app.yaml"),
		DisplayName:        "Generation Test App",
		Version:            "1.0.0",
		EntryRef:           "dist/main.js",
		PermissionScopeRef: "account:account.session.read",
		StoragePolicyRef:   "nimi-data-app-roots",
	}
}

func localAppAdoptionGenerationJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal adoption record: %v", err)
	}
	return raw
}
