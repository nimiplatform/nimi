package localservice

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCopyAndHashModelAssetFileUsesVerifiedSourceHandle(t *testing.T) {
	sourcePath := filepath.Join(t.TempDir(), "source.bin")
	destinationPath := filepath.Join(t.TempDir(), "destination.bin")
	payload := []byte("verified ModelAsset source payload")
	if err := os.WriteFile(sourcePath, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	identity := preflightModelAssetSourceIdentityForTest(t, sourcePath)

	digest, size, err := copyAndHashModelAssetFile(sourcePath, destinationPath, identity, nil)
	if err != nil {
		t.Fatalf("copy normal source: %v", err)
	}
	wantDigest := sha256.Sum256(payload)
	if digest != hex.EncodeToString(wantDigest[:]) || size != int64(len(payload)) {
		t.Fatalf("copy result = digest:%q size:%d", digest, size)
	}
	copied, err := os.ReadFile(destinationPath)
	if err != nil || !bytes.Equal(copied, payload) {
		t.Fatalf("copied payload = %q err=%v", copied, err)
	}
}

func TestCopyAndHashModelAssetFileRejectsPreflightIdentityReplacement(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "source.bin")
	if err := os.WriteFile(sourcePath, []byte("preflight payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	identity := preflightModelAssetSourceIdentityForTest(t, sourcePath)
	if err := os.Rename(sourcePath, filepath.Join(root, "preflight-original.bin")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sourcePath, []byte("replacement payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	destinationPath := filepath.Join(root, "destination.bin")

	_, _, err := copyAndHashModelAssetFile(sourcePath, destinationPath, identity, nil)
	assertModelAssetSourceSafetyErrorForTest(t, err)
	if _, statErr := os.Stat(destinationPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("identity mismatch left destination residue: %v", statErr)
	}
}

func TestCopyAndHashModelAssetFileRejectsSymlinkReplacement(t *testing.T) {
	root := t.TempDir()
	sourcePath := filepath.Join(root, "source.bin")
	outsidePath := filepath.Join(root, "outside.bin")
	if err := os.WriteFile(sourcePath, []byte("preflight payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outsidePath, []byte("must not be copied"), 0o600); err != nil {
		t.Fatal(err)
	}
	identity := preflightModelAssetSourceIdentityForTest(t, sourcePath)
	if err := os.Rename(sourcePath, filepath.Join(root, "preflight-original.bin")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outsidePath, sourcePath); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	destinationPath := filepath.Join(root, "destination.bin")

	_, _, err := copyAndHashModelAssetFile(sourcePath, destinationPath, identity, nil)
	assertModelAssetSourceSafetyErrorForTest(t, err)
	if _, statErr := os.Stat(destinationPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("symlink rejection left destination residue: %v", statErr)
	}
}

func preflightModelAssetSourceIdentityForTest(t *testing.T, path string) modelAssetSourceFileIdentity {
	t.Helper()
	info, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := preflightModelAssetSourceFile(path, info)
	if err != nil {
		t.Fatalf("preflight source identity: %v", err)
	}
	return identity
}

func assertModelAssetSourceSafetyErrorForTest(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("unsafe source was accepted")
	}
	var safetyErr *modelAssetSourceSafetyError
	if !errors.As(err, &safetyErr) {
		t.Fatalf("source rejection is not typed: %T %v", err, err)
	}
}
