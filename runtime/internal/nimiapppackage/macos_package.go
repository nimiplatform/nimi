package nimiapppackage

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const macOSExecutionProfileRef = "macos-user-mode-same-session-v1"

func makeStagingParents(root *os.Root, parent string, mode os.FileMode) error {
	if err := root.MkdirAll(parent, mode); err != nil {
		return err
	}
	if mode == 0o755 {
		for directory := parent; directory != "."; directory = filepath.Dir(directory) {
			if err := root.Chmod(directory, mode); err != nil {
				return err
			}
		}
	}
	return nil
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-034a
func validateMacOSExpected(expected Expected) error {
	native := expected.NativeTrust
	if expected.Arch != "arm64" || expected.ExecutionProfileRef != macOSExecutionProfileRef || native.WindowsCodeSigning != "not-applicable" {
		return ErrUnsupportedTarget
	}
	if native.SigningSubject == nil {
		if native.ObservedSubject != nil || native.MacOSDeveloperIDSubject != nil || native.MacOSNotarization != "absent" {
			return ErrUnsupportedTarget
		}
		return nil
	}
	if *native.SigningSubject != "publisher" || native.ObservedSubject == nil || native.MacOSDeveloperIDSubject == nil || !exactText(*native.MacOSDeveloperIDSubject) || *native.ObservedSubject != *native.MacOSDeveloperIDSubject || (native.MacOSNotarization != "absent" && native.MacOSNotarization != "notarized") {
		return ErrUnsupportedTarget
	}
	return nil
}

func validateMacOSManifest(manifest Manifest, expected Expected) error {
	if manifest.ExecutionProfile.LaunchMode != "current-user" || manifest.NativeTrust.MacOSNotarization != expected.NativeTrust.MacOSNotarization {
		return ErrPackageIntegrity
	}
	if expected.NativeTrust.SigningSubject == nil {
		if manifest.NativeTrust.Posture != "production-unsigned" || manifest.NativeTrust.MacOSDeveloperID != "absent" || !bytes.Equal(bytes.TrimSpace(manifest.NativeTrust.CertificateSubject), []byte("null")) {
			return ErrPackageIntegrity
		}
		return nil
	}
	var subject string
	if err := json.Unmarshal(manifest.NativeTrust.CertificateSubject, &subject); err != nil || expected.NativeTrust.MacOSDeveloperIDSubject == nil || subject != *expected.NativeTrust.MacOSDeveloperIDSubject || manifest.NativeTrust.Posture != "observed-valid-native-signature" || manifest.NativeTrust.MacOSDeveloperID != "valid" {
		return ErrPackageIntegrity
	}
	return nil
}

func validatePlatformManifestShape(raw []byte, targetOS string) error {
	var fields struct {
		Native    map[string]json.RawMessage `json:"native_trust"`
		Execution map[string]json.RawMessage `json:"execution_profile"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return ErrInvalidPackage
	}
	nativeKeys := []string{"posture", "windows_authenticode", "certificate_subject"}
	executionKeys := []string{"requested_execution_level", "ui_access"}
	if targetOS == "macos" {
		nativeKeys = []string{"posture", "macos_developer_id", "macos_notarization", "certificate_subject"}
		executionKeys = []string{"launch_mode"}
	}
	for _, expected := range []struct {
		fields map[string]json.RawMessage
		keys   []string
	}{{fields.Native, nativeKeys}, {fields.Execution, executionKeys}} {
		if len(expected.fields) != len(expected.keys) {
			return ErrInvalidPackage
		}
		for _, key := range expected.keys {
			if _, exists := expected.fields[key]; !exists {
				return ErrInvalidPackage
			}
		}
	}
	return nil
}

func validEntryMode(mode os.FileMode, targetOS string) bool {
	if mode&(os.ModeSetuid|os.ModeSetgid|os.ModeSticky) != 0 {
		return false
	}
	if mode.IsRegular() {
		return mode.Perm() == 0o644 || mode.Perm() == 0o755
	}
	return targetOS == "macos" && mode&os.ModeType == os.ModeSymlink && mode.Perm() == 0o777
}

type payloadLinkEntry struct {
	target   string
	symbolic bool
}

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
func validatePayloadLinkTree(entries map[string]payloadLinkEntry, targetOS string) error {
	directories := make(map[string]bool)
	for name := range entries {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			directories[parent] = true
		}
	}
	var resolve func(string, map[string]bool) error
	resolve = func(name string, visited map[string]bool) error {
		parts := strings.Split(name, "/")
		for count := 1; count <= len(parts); count++ {
			prefix := strings.Join(parts[:count], "/")
			entry, exists := entries[prefix]
			if !exists || !entry.symbolic {
				continue
			}
			if visited[prefix] {
				return fmt.Errorf("cyclic bundle link %s: %w", prefix, ErrInvalidPackage)
			}
			if targetOS != "macos" || !strings.HasPrefix(prefix, "payload/") || entry.target == "" || !utf8.ValidString(entry.target) || path.IsAbs(entry.target) || strings.ContainsAny(entry.target, "\\\x00") {
				return ErrInvalidPackage
			}
			destination := path.Join(append([]string{path.Dir(prefix), entry.target}, parts[count:]...)...)
			if !strings.HasPrefix(destination, "payload/") {
				return fmt.Errorf("bundle link escapes payload: %w", ErrInvalidPackage)
			}
			visited[prefix] = true
			return resolve(destination, visited)
		}
		if _, exists := entries[name]; !exists && !directories[name] {
			return fmt.Errorf("missing bundle link destination %s: %w", name, ErrInvalidPackage)
		}
		return nil
	}
	for name, entry := range entries {
		if directories[name] {
			return fmt.Errorf("bundle file/directory collision: %w", ErrInvalidPackage)
		}
		if entry.symbolic {
			if err := resolve(name, make(map[string]bool)); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateArchiveLinks(ctx context.Context, reader *zip.Reader, targetOS string) error {
	entries := make(map[string]payloadLinkEntry, len(reader.File))
	for _, entry := range reader.File {
		value := payloadLinkEntry{symbolic: entry.Mode()&os.ModeSymlink != 0}
		if value.symbolic {
			target, err := readControlEntry(ctx, entry, maxControlDocumentBytes)
			if err != nil {
				return err
			}
			value.target = string(target)
		}
		entries[entry.Name] = value
	}
	return validatePayloadLinkTree(entries, targetOS)
}
