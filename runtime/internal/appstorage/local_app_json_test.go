package appstorage

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalAppJSONStorageIsPrincipalPartitionedAndRedacted(t *testing.T) {
	dataRoot := t.TempDir()
	firstOwner := ManagedOwner{AccountID: "account-1", RegisteredAppSubject: "lap_v1_first"}
	secondSubject := ManagedOwner{AccountID: "account-1", RegisteredAppSubject: "lap_v1_second"}
	secondAccount := ManagedOwner{AccountID: "account-2", RegisteredAppSubject: "lap_v1_first"}
	first, err := WriteLocalAppJSON(dataRoot, firstOwner, "agent-chat/binding.json", []byte(`{"value": 1}`))
	if err != nil {
		t.Fatalf("write first principal: %v", err)
	}
	if string(first.JSONValue) != `{"value":1}` || first.SizeBytes != int64(len(first.JSONValue)) {
		t.Fatalf("canonical result = %+v", first)
	}
	if _, err := ReadLocalAppJSON(dataRoot, secondSubject, "agent-chat/binding.json"); !errors.Is(err, ErrLocalAppJSONNotFound) {
		t.Fatalf("cross-principal read error = %v", err)
	}
	if _, err := ReadLocalAppJSON(dataRoot, secondAccount, "agent-chat/binding.json"); !errors.Is(err, ErrLocalAppJSONNotFound) {
		t.Fatalf("cross-account read error = %v", err)
	}
	read, err := ReadLocalAppJSON(dataRoot, firstOwner, "agent-chat/binding.json")
	if err != nil || !bytes.Equal(read.JSONValue, first.JSONValue) {
		t.Fatalf("read first principal = (%+v, %v)", read, err)
	}
	replaced, err := WriteLocalAppJSON(dataRoot, firstOwner, "agent-chat/binding.json", []byte(`{"value": 2}`))
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
	owner := ManagedOwner{AccountID: "account-1", RegisteredAppSubject: "lap_v1_test"}
	if _, err := WriteLocalAppJSON(t.TempDir(), owner, "valid/value.json", []byte(`{"unterminated"`)); !errors.Is(err, ErrLocalAppJSONValueInvalid) {
		t.Fatalf("invalid JSON error = %v", err)
	}
	oversized := bytes.Repeat([]byte(" "), LocalAppJSONMaxDocumentBytes+1)
	if _, err := WriteLocalAppJSON(t.TempDir(), owner, "valid/value.json", oversized); !errors.Is(err, ErrLocalAppJSONQuota) {
		t.Fatalf("oversized JSON error = %v", err)
	}
}

func TestLocalAppJSONStorageEnforcesPartitionQuota(t *testing.T) {
	dataRoot := t.TempDir()
	owner := ManagedOwner{AccountID: "account-1", RegisteredAppSubject: "lap_v1_quota"}
	value := append([]byte{'"'}, bytes.Repeat([]byte{'x'}, LocalAppJSONMaxDocumentBytes-2)...)
	value = append(value, '"')
	for index := 0; index < LocalAppJSONPartitionQuotaBytes/LocalAppJSONMaxDocumentBytes; index++ {
		path := fmt.Sprintf("state/value-%02d.json", index)
		if _, err := WriteLocalAppJSON(dataRoot, owner, path, value); err != nil {
			t.Fatalf("fill JSON quota at %d: %v", index, err)
		}
	}
	if _, err := WriteLocalAppJSON(dataRoot, owner, "state/value.json", []byte(`{}`)); !errors.Is(err, ErrLocalAppJSONQuota) {
		t.Fatalf("partition quota error = %v", err)
	}
}

func TestLocalAppJSONStorageRemoveIsIdempotent(t *testing.T) {
	dataRoot := t.TempDir()
	owner := ManagedOwner{AccountID: "account-1", RegisteredAppSubject: "lap_v1_remove"}
	if _, err := WriteLocalAppJSON(dataRoot, owner, "state/value.json", []byte(`true`)); err != nil {
		t.Fatal(err)
	}
	removed, err := RemoveLocalAppJSON(dataRoot, owner, "state/value.json")
	if err != nil || !removed {
		t.Fatalf("first remove = (%v, %v)", removed, err)
	}
	removed, err = RemoveLocalAppJSON(dataRoot, owner, "state/value.json")
	if err != nil || removed {
		t.Fatalf("idempotent remove = (%v, %v)", removed, err)
	}
}

func TestLocalAppJSONStorageRejectsSymlinkComponents(t *testing.T) {
	dataRoot := t.TempDir()
	owner := ManagedOwner{AccountID: "account-1", RegisteredAppSubject: "lap_v1_symlink"}
	root, _, err := localAppJSONRoot(dataRoot, owner, "linked/value.json")
	if err != nil {
		t.Fatal(err)
	}
	target := t.TempDir()
	link := filepath.Join(root, encodeManagedComponent("linked")[0])
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	if _, err := WriteLocalAppJSON(dataRoot, owner, "linked/value.json", []byte(`{}`)); !errors.Is(err, ErrLocalAppJSONUnavailable) {
		t.Fatalf("symlink write error = %v", err)
	}
}

func TestLocalAppJSONStorageHardCutsSubjectOnlyLegacyPath(t *testing.T) {
	dataRoot := t.TempDir()
	legacy, err := ResolveAppRoots(dataRoot, "lap_v1_legacy", "nimi-data-app-roots")
	if err != nil {
		t.Fatal(err)
	}
	if err := MaterializeAppRoots(legacy); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy.DurableDataRoot, "legacy.json"), []byte(`{"legacy":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	owner := ManagedOwner{AccountID: "account-1", RegisteredAppSubject: "lap_v1_legacy"}
	if _, err := ReadLocalAppJSON(dataRoot, owner, "legacy.json"); !errors.Is(err, ErrLocalAppJSONNotFound) {
		t.Fatalf("subject-only legacy data was rebound: %v", err)
	}
}
