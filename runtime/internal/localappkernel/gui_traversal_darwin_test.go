//go:build darwin && cgo

package localappkernel

import (
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestNewAppDirectoryGrantsOnlyNoninheritedSearch(t *testing.T) {
	account, err := user.Lookup("daemon")
	if err != nil {
		t.Fatal(err)
	}
	id, err := strconv.ParseUint(account.Uid, 10, 32)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := ValidateVerifiedMacOSInteractiveUser(uint32(id), 1)
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(t.TempDir(), "apps")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := prepareNewAppDirectory(directory, identity); err != nil {
			t.Fatal(err)
		}
	}
	acl, err := exec.Command("/bin/ls", "-lde", directory).Output()
	if err != nil {
		t.Fatal(err)
	}
	var entries []string
	for _, line := range strings.Split(string(acl), "\n") {
		if strings.Contains(line, "user:daemon ") {
			entries = append(entries, strings.TrimSpace(line))
		}
	}
	if len(entries) != 1 || !strings.HasSuffix(entries[0], "user:daemon allow search") {
		t.Fatalf("unexpected user ACL: %v", entries)
	}
	private := filepath.Join(directory, "private")
	if err := os.WriteFile(private, []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	acl, err = exec.Command("/bin/ls", "-le", private).Output()
	if err != nil || strings.Contains(string(acl), "user:daemon ") {
		t.Fatalf("private child inherited access: %q, %v", acl, err)
	}
}
