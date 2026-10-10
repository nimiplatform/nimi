package productrelease

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestProductPathChainWalksActualProductLevelForEveryConsumer(t *testing.T) {
	programFiles := t.TempDir()
	product := filepath.Join(programFiles, "Nimi", "Product")
	version := filepath.Join(product, "0.3.0")
	for _, role := range []string{"Nimi.exe", "runtime/nimi.exe", "NimiProductUpdater.exe", IdentityFile} {
		file := filepath.Join(version, filepath.FromSlash(role))
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(role), 0600); err != nil {
			t.Fatal(err)
		}
		actual, paths, err := productPathChain(product, file)
		if err != nil || actual != version {
			t.Fatalf("role %s root %s err %v", role, actual, err)
		}
		wanted := []string{filepath.Dir(product), product, version}
		if role == "runtime/nimi.exe" {
			wanted = append(wanted, filepath.Join(version, "runtime"))
		}
		wanted = append(wanted, file)
		if !reflect.DeepEqual(paths, wanted) {
			t.Fatalf("role %s paths %#v wanted %#v", role, paths, wanted)
		}
		for _, path := range paths {
			if _, err := os.Lstat(path); err != nil {
				t.Fatalf("walked non-existing path %s: %v", path, err)
			}
		}
	}
}
func TestProductPathChainRejectsOutsideAndMissingRelease(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Nimi", "Product")
	for _, file := range []string{root, filepath.Join(root, "0.3.0"), filepath.Join(filepath.Dir(root), "0.3.0", "Nimi.exe"), filepath.Join(root, "..", "outside", "Nimi.exe")} {
		if _, _, err := productPathChain(root, file); err == nil {
			t.Fatalf("path admitted: %s", file)
		}
	}
}
