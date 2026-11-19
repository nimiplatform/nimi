//go:build darwin && cgo && nimi_macos_local_development

package grpcserver

import (
	"os"
	"os/user"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

func TestFixedDevelopmentControlLocatorUsesVerifiedUsersSeparateDirectory(t *testing.T) {
	account, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(uint32(os.Geteuid()), 1)
	if err != nil {
		t.Fatal(err)
	}
	root, err := ResolveProtectedProductControlRoot(identity)
	if err != nil || root != filepath.Join(account.HomeDir, ".nimi-dev", ".nimi") {
		t.Fatalf("unexpected fixed development Product Control locator %q: %v", root, err)
	}
}
