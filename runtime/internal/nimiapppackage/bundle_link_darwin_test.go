package nimiapppackage

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestMacOSFrameworkLinkPublishedUnderServiceUmask(t *testing.T) {
	archive, expected := macOSArchiveFixture(t, "A")
	owner, _ := openOwnerRoot(t)
	// The fixed service runs with a private umask. Keep this test sequential.
	previous := unix.Umask(0o077)
	t.Cleanup(func() { unix.Umask(previous) })
	materialized, err := Materialize(context.Background(), archive, owner, "stage", expected)
	if err != nil {
		t.Fatal(err)
	}
	versions := filepath.Join(materialized.Root, "payload/Example.app/Contents/Frameworks/F.framework/Versions")
	link, err := os.Lstat(filepath.Join(versions, "Current"))
	if err != nil {
		t.Fatal(err)
	}
	if link.Mode() != os.ModeSymlink|0o777 {
		t.Fatalf("published framework link mode = %v, want Lrwxrwxrwx", link.Mode())
	}
	target, err := os.Stat(filepath.Join(versions, "A"))
	if err != nil {
		t.Fatal(err)
	}
	if target.Mode().Perm() != 0o755 {
		t.Fatalf("framework target permissions = %o, want 755", target.Mode().Perm())
	}
}
