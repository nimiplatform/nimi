package nimiapppackage

import (
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
	} else if targetOS == "any" {
		nativeKeys = []string{"posture", "certificate_subject"}
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

const maxMacOSSymlinkHops = 32

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
func validatePayloadLinkTree(entries map[string]payloadLinkEntry, targetOS string) error {
	directories := make(map[string]bool)
	for name := range entries {
		for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
			directories[parent] = true
		}
	}
	for name := range entries {
		if directories[name] {
			return fmt.Errorf("bundle file/directory collision: %w", ErrInvalidPackage)
		}
	}

	var resolveComponents func(base []string, rawTarget string, hops *int, active map[string]bool) ([]string, bool, error)
	resolveComponents = func(base []string, rawTarget string, hops *int, active map[string]bool) ([]string, bool, error) {
		if rawTarget == "" || !utf8.ValidString(rawTarget) || strings.HasPrefix(rawTarget, "/") || strings.ContainsAny(rawTarget, "\\\x00") {
			return nil, false, ErrInvalidPackage
		}
		cur := append([]string(nil), base...)
		trailingDir := strings.HasSuffix(rawTarget, "/")
		parts := strings.Split(rawTarget, "/")
		for index, part := range parts {
			isLast := index == len(parts)-1
			switch part {
			case "":
				if !directories[strings.Join(cur, "/")] {
					return nil, false, fmt.Errorf("bundle link non-directory traversal: %w", ErrInvalidPackage)
				}
				continue
			case ".":
				if !directories[strings.Join(cur, "/")] {
					return nil, false, fmt.Errorf("bundle link non-directory dot traversal: %w", ErrInvalidPackage)
				}
				if isLast {
					trailingDir = true
				}
				continue
			case "..":
				if !directories[strings.Join(cur, "/")] {
					return nil, false, fmt.Errorf("bundle link non-directory parent traversal: %w", ErrInvalidPackage)
				}
				if len(cur) <= 1 {
					return nil, false, fmt.Errorf("bundle link escapes payload: %w", ErrInvalidPackage)
				}
				cur = cur[:len(cur)-1]
				if isLast {
					trailingDir = true
				}
				continue
			default:
				if !directories[strings.Join(cur, "/")] {
					return nil, false, fmt.Errorf("bundle link traverses non-directory: %w", ErrInvalidPackage)
				}
				cur = append(cur, part)
				joined := strings.Join(cur, "/")
				if entry, exists := entries[joined]; exists && entry.symbolic {
					if active[joined] {
						return nil, false, fmt.Errorf("cyclic bundle link %s: %w", joined, ErrInvalidPackage)
					}
					*hops++
					if *hops > maxMacOSSymlinkHops {
						return nil, false, fmt.Errorf("excessive bundle link hops %s: %w", joined, ErrInvalidPackage)
					}
					active[joined] = true
					resolved, resolvedDir, err := resolveComponents(cur[:len(cur)-1], entry.target, hops, active)
					delete(active, joined)
					if err != nil {
						return nil, false, err
					}
					cur = resolved
					if isLast && resolvedDir {
						trailingDir = true
					}
				}
			}
		}
		return cur, trailingDir, nil
	}

	for name, entry := range entries {
		if !entry.symbolic {
			continue
		}
		if targetOS != "macos" || !strings.HasPrefix(name, "payload/") {
			return ErrInvalidPackage
		}
		parentParts := strings.Split(path.Dir(name), "/")
		hops := 1
		active := map[string]bool{name: true}
		resolved, requireDir, err := resolveComponents(parentParts, entry.target, &hops, active)
		if err != nil {
			return err
		}
		if len(resolved) < 2 || resolved[0] != "payload" {
			return fmt.Errorf("bundle link escapes payload: %w", ErrInvalidPackage)
		}
		finalPath := strings.Join(resolved, "/")
		if requireDir {
			if !directories[finalPath] {
				return fmt.Errorf("missing bundle link directory destination %s: %w", finalPath, ErrInvalidPackage)
			}
		} else if _, exists := entries[finalPath]; !exists && !directories[finalPath] {
			return fmt.Errorf("missing bundle link destination %s: %w", finalPath, ErrInvalidPackage)
		}
	}
	return nil
}

func validateCanonicalArchiveLinks(ctx context.Context, archive *canonicalZipArchive, targetOS string) error {
	entries := make(map[string]payloadLinkEntry, len(archive.entries))
	for _, entry := range archive.entries {
		value := payloadLinkEntry{symbolic: entry.Mode&os.ModeSymlink != 0}
		if value.symbolic {
			if targetOS != "macos" {
				return ErrInvalidPackage
			}
			target, err := readCanonicalSymlinkTarget(ctx, archive.ra, entry)
			if err != nil {
				return err
			}
			value.target = target
		}
		entries[entry.Name] = value
	}
	return validatePayloadLinkTree(entries, targetOS)
}
