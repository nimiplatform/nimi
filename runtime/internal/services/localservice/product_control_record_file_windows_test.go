//go:build windows

package localservice

import (
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

type productControlRecordWindowsFileInfoForTest struct {
	attributes uint32
}

func (info productControlRecordWindowsFileInfoForTest) Name() string       { return "nimi.json" }
func (info productControlRecordWindowsFileInfoForTest) Size() int64        { return 1 }
func (info productControlRecordWindowsFileInfoForTest) Mode() fs.FileMode  { return 0o600 }
func (info productControlRecordWindowsFileInfoForTest) ModTime() time.Time { return time.Time{} }
func (info productControlRecordWindowsFileInfoForTest) IsDir() bool        { return false }
func (info productControlRecordWindowsFileInfoForTest) Sys() any {
	return &syscall.Win32FileAttributeData{FileAttributes: info.attributes}
}

func TestProductControlRecordWindowsReparseAttributeFailsClosed(t *testing.T) {
	reparse := productControlRecordWindowsFileInfoForTest{
		attributes: syscall.FILE_ATTRIBUTE_REPARSE_POINT,
	}
	if !productControlRecordIsReparsePoint(reparse) {
		t.Fatal("Windows reparse-point attribute was admitted")
	}
	regular := productControlRecordWindowsFileInfoForTest{
		attributes: syscall.FILE_ATTRIBUTE_NORMAL,
	}
	if productControlRecordIsReparsePoint(regular) {
		t.Fatal("ordinary Windows file was classified as a reparse point")
	}
}

func TestProductControlRecordRejectsDisposableWindowsDotNimiJunction(t *testing.T) {
	profile := t.TempDir()
	target := t.TempDir()
	junction := filepath.Join(profile, ".nimi")
	dataRoot := `D:\NimiJunctionVectorData`
	raw, err := json.Marshal(productControlBindingRecordForTest(dataRoot))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "nimi.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("cmd.exe", "/d", "/c", "mklink", "/J", junction, target)
	if output, err := command.CombinedOutput(); err != nil {
		t.Skipf(
			"Windows junction creation is unavailable; Win32 reparse attribute case remains active: %v (%s)",
			err,
			strings.TrimSpace(string(output)),
		)
	}
	junctionExists := true
	defer func() {
		if junctionExists {
			if err := os.Remove(junction); err != nil && !os.IsNotExist(err) {
				t.Errorf("remove disposable Product Control junction: %v", err)
			}
		}
	}()
	info, err := os.Lstat(junction)
	if err != nil {
		t.Fatalf("inspect created disposable Product Control junction: %v", err)
	}
	if !productControlRecordIsReparsePoint(info) {
		t.Fatal("mklink /J did not create a Win32 reparse point")
	}
	if _, err := readProductControlRecord(filepath.Join(junction, "nimi.json")); err == nil ||
		!strings.Contains(err.Error(), "direct non-reparse directory") {
		t.Fatalf("disposable .nimi junction read error = %v", err)
	}
	if err := os.Remove(junction); err != nil {
		t.Fatalf("remove disposable Product Control junction: %v", err)
	}
	junctionExists = false
	if _, err := os.Lstat(junction); !os.IsNotExist(err) {
		t.Fatalf("disposable Product Control junction cleanup left path behind: %v", err)
	}
	if _, err := os.Stat(filepath.Join(target, "nimi.json")); err != nil {
		t.Fatalf("junction cleanup damaged disposable target: %v", err)
	}
}
