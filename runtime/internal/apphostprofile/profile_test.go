package apphostprofile

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func testDataRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join(t.TempDir(), "nimi_data"))
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func TestAppProfileRootIsStableAndScoped(t *testing.T) {
	root := testDataRoot(t)
	first, err := AppProfileRoot(root, "install-a", "loua_v2_user", "ras_subject-1")
	if err != nil {
		t.Fatal(err)
	}
	again, err := AppProfileRoot(root, "install-a", "loua_v2_user", "ras_subject-1")
	if err != nil || again != first {
		t.Fatalf("same inputs must map to the same profile: %q %q %v", first, again, err)
	}
	scope, err := HostScopeRoot(root, "install-a", "loua_v2_user")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(filepath.Dir(first)) != scope || filepath.Base(filepath.Dir(first)) != "apps" {
		t.Fatalf("app profile %q must live under scope %q/apps", first, scope)
	}
	if filepath.Dir(filepath.Dir(scope)) != root || filepath.Base(filepath.Dir(scope)) != DirectoryName {
		t.Fatalf("scope %q must live under %q/%s", scope, root, DirectoryName)
	}
	for _, name := range []string{filepath.Base(scope), filepath.Base(first)} {
		if len(name) != 2*keyDigestBytes || strings.ToLower(name) != name {
			t.Fatalf("hashed name %q must be fixed-length lowercase hex", name)
		}
	}
	for _, input := range [][3]string{
		{"install-b", "loua_v2_user", "ras_subject-1"},
		{"install-a", "loua_v2_other", "ras_subject-1"},
		{"install-a", "loua_v2_user", "ras_subject-2"},
	} {
		other, err := AppProfileRoot(root, input[0], input[1], input[2])
		if err != nil || other == first {
			t.Fatalf("different identity %v must map elsewhere: %q %v", input, other, err)
		}
	}
}

func TestHashedKeyEncodingIsUnambiguous(t *testing.T) {
	left, err := hashedKey("prefix", "ab", "c")
	if err != nil {
		t.Fatal(err)
	}
	right, err := hashedKey("prefix", "a", "bc")
	if err != nil {
		t.Fatal(err)
	}
	if left == right {
		t.Fatal("length-delimited fields must not collide on concatenation")
	}
}

func TestProfileRootRejectsInvalidInputs(t *testing.T) {
	root := testDataRoot(t)
	volumeRoot := filepath.VolumeName(root) + string(filepath.Separator)
	cases := [][4]string{
		{"relative/root", "install", "anchor", "subject"},
		{volumeRoot, "install", "anchor", "subject"},
		{" " + root, "install", "anchor", "subject"},
		{root, "", "anchor", "subject"},
		{root, "install", " anchor", "subject"},
		{root, "install", "anchor", ""},
	}
	for _, input := range cases {
		if _, err := AppProfileRoot(input[0], input[1], input[2], input[3]); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("input %q must fail closed, got %v", input, err)
		}
	}
}
