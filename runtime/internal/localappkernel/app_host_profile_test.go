package localappkernel

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/apphostprofile"
)

func TestAppHostProfileRootDerivesFromKernelIdentityAndSubject(t *testing.T) {
	ctx := context.Background()
	dataRoot := filepath.Join(t.TempDir(), "nimi_data")
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	kernel := openTestKernelAtDataRoot(t, dataRoot, identity, "install-one", 0x21)
	first, err := kernel.Registrations().RegisterDevelopment(ctx, developmentInput())
	if err != nil {
		t.Fatal(err)
	}
	second, err := kernel.Registrations().RegisterDevelopment(ctx, developmentInput())
	if err != nil {
		t.Fatal(err)
	}
	firstRoot, err := kernel.AppHostProfileRoot(first.RegisteredAppSubject)
	if err != nil {
		t.Fatal(err)
	}
	secondRoot, err := kernel.AppHostProfileRoot(second.RegisteredAppSubject)
	if err != nil {
		t.Fatal(err)
	}
	if firstRoot == secondRoot {
		t.Fatal("registrations with the same App id must not share a Host profile")
	}
	appHosts := filepath.Join(dataRoot, apphostprofile.DirectoryName) + string(filepath.Separator)
	for _, root := range []string{firstRoot, secondRoot} {
		if !strings.HasPrefix(root, appHosts) {
			t.Fatalf("profile %q must be under %q", root, appHosts)
		}
		if strings.Contains(root, first.RegisteredAppSubject) || strings.Contains(root, "install-one") {
			t.Fatalf("profile %q must not expose raw identity", root)
		}
	}
	anchor := kernel.LocalOSUserAnchor()
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}

	reopened := openTestKernelAtDataRoot(t, dataRoot, identity, "install-one", 0x31)
	defer func() { _ = reopened.Close() }()
	again, err := reopened.AppHostProfileRoot(first.RegisteredAppSubject)
	if err != nil || again != firstRoot {
		t.Fatalf("restart must keep the same subject profile: %q %q %v", again, firstRoot, err)
	}
	want, err := apphostprofile.AppProfileRoot(dataRoot, "install-one", anchor, first.RegisteredAppSubject)
	if err != nil || want != firstRoot {
		t.Fatalf("kernel projection must equal the shared helper: %q %q %v", want, firstRoot, err)
	}
	if _, err := reopened.AppHostProfileRoot(""); err == nil {
		t.Fatal("an empty subject must fail closed")
	}
}
