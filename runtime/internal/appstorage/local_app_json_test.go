package appstorage

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalAppJSONStorageIsPrincipalPartitionedAndRedacted(t *testing.T) {
	dataRoot := t.TempDir()
	first, err := WriteLocalAppJSON(dataRoot, "lap_v1_first", "agent-chat/binding.json", []byte(`{"value": 1}`))
	if err != nil {
		t.Fatalf("write first principal: %v", err)
	}
	if string(first.JSONValue) != `{"value":1}` || first.SizeBytes != int64(len(first.JSONValue)) {
		t.Fatalf("canonical result = %+v", first)
	}
	if _, err := ReadLocalAppJSON(dataRoot, "lap_v1_second", "agent-chat/binding.json"); !errors.Is(err, ErrLocalAppJSONNotFound) {
		t.Fatalf("cross-principal read error = %v", err)
	}
	read, err := ReadLocalAppJSON(dataRoot, "lap_v1_first", "agent-chat/binding.json")
	if err != nil || !bytes.Equal(read.JSONValue, first.JSONValue) {
		t.Fatalf("read first principal = (%+v, %v)", read, err)
	}
	replaced, err := WriteLocalAppJSON(dataRoot, "lap_v1_first", "agent-chat/binding.json", []byte(`{"value": 2}`))
	if err != nil || string(replaced.JSONValue) != `{"value":2}` {
		t.Fatalf("replace first principal = (%+v, %v)", replaced, err)
	}
}

func TestLocalAppJSONStorageRejectsNonCanonicalPathsAndValues(t *testing.T) {
	invalidPaths := []string{
		"", " binding.json", "../binding.json", "agent-chat/../binding.json",
		"agent-chat\\binding.json", "C:/binding.json", "/binding.json", "agent chat/binding.json",
		"agent-chat/CON.json", "agent-chat/binding.txt", ".hidden/binding.json",
	}
	for _, value := range invalidPaths {
		if _, err := NormalizeLocalAppJSONRelativePath(value); !errors.Is(err, ErrLocalAppJSONPathInvalid) {
			t.Errorf("NormalizeLocalAppJSONRelativePath(%q) error = %v", value, err)
		}
	}
	if _, err := WriteLocalAppJSON(t.TempDir(), "lap_v1_test", "valid/value.json", []byte(`{"unterminated"`)); !errors.Is(err, ErrLocalAppJSONValueInvalid) {
		t.Fatalf("invalid JSON error = %v", err)
	}
	oversized := bytes.Repeat([]byte(" "), LocalAppJSONMaxDocumentBytes+1)
	if _, err := WriteLocalAppJSON(t.TempDir(), "lap_v1_test", "valid/value.json", oversized); !errors.Is(err, ErrLocalAppJSONQuota) {
		t.Fatalf("oversized JSON error = %v", err)
	}
}

func TestLocalAppJSONStorageEnforcesPartitionQuota(t *testing.T) {
	dataRoot := t.TempDir()
	plan, err := ResolveAppRoots(dataRoot, "lap_v1_quota", "nimi-data-app-roots")
	if err != nil {
		t.Fatal(err)
	}
	if err := MaterializeAppRoots(plan); err != nil {
		t.Fatal(err)
	}
	filler := filepath.Join(plan.DurableDataRoot, "quota.bin")
	file, err := os.Create(filler)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(LocalAppJSONPartitionQuotaBytes); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteLocalAppJSON(dataRoot, "lap_v1_quota", "state/value.json", []byte(`{}`)); !errors.Is(err, ErrLocalAppJSONQuota) {
		t.Fatalf("partition quota error = %v", err)
	}
}

func TestLocalAppJSONStorageRemoveIsIdempotent(t *testing.T) {
	dataRoot := t.TempDir()
	if _, err := WriteLocalAppJSON(dataRoot, "lap_v1_remove", "state/value.json", []byte(`true`)); err != nil {
		t.Fatal(err)
	}
	removed, err := RemoveLocalAppJSON(dataRoot, "lap_v1_remove", "state/value.json")
	if err != nil || !removed {
		t.Fatalf("first remove = (%v, %v)", removed, err)
	}
	removed, err = RemoveLocalAppJSON(dataRoot, "lap_v1_remove", "state/value.json")
	if err != nil || removed {
		t.Fatalf("idempotent remove = (%v, %v)", removed, err)
	}
}

func TestLocalAppJSONStorageRejectsSymlinkComponents(t *testing.T) {
	dataRoot := t.TempDir()
	plan, err := ResolveAppRoots(dataRoot, "lap_v1_symlink", "nimi-data-app-roots")
	if err != nil {
		t.Fatal(err)
	}
	if err := MaterializeAppRoots(plan); err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	link := filepath.Join(plan.DurableDataRoot, "linked")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	if _, err := WriteLocalAppJSON(dataRoot, "lap_v1_symlink", "linked/value.json", []byte(`{}`)); !errors.Is(err, ErrLocalAppJSONUnavailable) {
		t.Fatalf("symlink write error = %v", err)
	}
}
