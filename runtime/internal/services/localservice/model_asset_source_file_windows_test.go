//go:build windows

package localservice

import (
	"errors"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsModelAssetSourceHandleRejectsReparsePoint(t *testing.T) {
	information := windows.ByHandleFileInformation{FileAttributes: windows.FILE_ATTRIBUTE_REPARSE_POINT}
	if !windowsModelAssetSourceHandleIsReparse(information) {
		t.Fatal("reparse-point handle was not detected")
	}
	var safetyErr *modelAssetSourceSafetyError
	if err := validateWindowsModelAssetSourceHandle(`C:\source-link.bin`, information, nil); !errors.As(err, &safetyErr) {
		t.Fatalf("reparse-point rejection is not typed: %T %v", err, err)
	}
}

func TestWindowsModelAssetSourceHandleRejectsPreflightIdentityMismatch(t *testing.T) {
	expected := modelAssetSourceFileIdentity{valid: true, volumeSerial: 7, fileIndex: 11}
	information := windows.ByHandleFileInformation{VolumeSerialNumber: 7, FileIndexLow: 12}
	if windowsModelAssetSourceHandleMatchesIdentity(information, expected) {
		t.Fatal("different file index matched preflight identity")
	}
	var safetyErr *modelAssetSourceSafetyError
	if err := validateWindowsModelAssetSourceHandle(`C:\replacement.bin`, information, &expected); !errors.As(err, &safetyErr) {
		t.Fatalf("identity-mismatch rejection is not typed: %T %v", err, err)
	}
}
