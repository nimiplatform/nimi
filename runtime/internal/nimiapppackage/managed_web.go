package nimiapppackage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// @nimi-authority: definition.nimi.platform.app-ecosystem.managed-web-desktop-carrier
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-014a
const (
	ManagedWebExecutionProfileRef = "nimi-managed-web-v1"
	ManagedWebTargetID            = "desktop-universal"
	ManagedWebRuntimeEntry        = "payload/index.html"
	ManagedWebMaxReleaseBytes     = 64 * 1024 * 1024
	ManagedWebMaxArchiveBytes     = ManagedWebMaxReleaseBytes + 8*1024*1024
	ManagedWebMaxReleaseEntries   = 10_000
	managedWebMaxDirectoryDepth   = 64

	defaultWindowWidth     = 1280
	defaultWindowHeight    = 840
	defaultWindowMinWidth  = 480
	defaultWindowMinHeight = 420
)

func IsManagedWebExecutionProfile(ref string) bool {
	return ref == ManagedWebExecutionProfileRef
}

func IsManagedWebTarget(expected Expected) bool {
	return expected.OS == "any" || expected.ExecutionProfileRef == ManagedWebExecutionProfileRef || expected.TargetID == ManagedWebTargetID
}

func validateManagedWebExpected(expected Expected) error {
	native := expected.NativeTrust
	if expected.TargetID != ManagedWebTargetID || expected.OS != "any" || expected.Arch != "any" ||
		expected.RuntimeEntry != ManagedWebRuntimeEntry || expected.ExecutionProfileRef != ManagedWebExecutionProfileRef {
		return ErrUnsupportedTarget
	}
	if native.WindowsCodeSigning != "not-applicable" || native.MacOSNotarization != "not-applicable" ||
		native.SigningSubject != nil || native.ObservedSubject != nil || native.MacOSDeveloperIDSubject != nil {
		return ErrUnsupportedTarget
	}
	return nil
}

func validateManagedWebManifest(manifest Manifest) error {
	if manifest.ExecutionProfile == nil || manifest.ExecutionProfile.LaunchMode != ManagedWebExecutionProfileRef {
		return ErrPackageIntegrity
	}
	if manifest.NativeTrust.Posture != "nimi-managed-carrier" ||
		!bytes.Equal(bytes.TrimSpace(manifest.NativeTrust.CertificateSubject), []byte("null")) {
		return ErrPackageIntegrity
	}
	return nil
}

// validateDeclarationDesktopWindow enforces the closed desktop.window schema
// and geometric bounds inside packaged nimi.app.yaml before install commit.
func validateDeclarationDesktopWindow(root *yaml.Node) error {
	desktopNode, found := mappingValueNode(root, "desktop")
	if !found {
		return nil
	}
	if desktopNode.Kind != yaml.MappingNode {
		return fmt.Errorf("validate nimiapp declaration desktop: %w", ErrInvalidPackage)
	}
	seenDesktop := make(map[string]struct{}, len(desktopNode.Content)/2)
	var windowNode *yaml.Node
	for index := 0; index < len(desktopNode.Content); index += 2 {
		key := desktopNode.Content[index]
		value := desktopNode.Content[index+1]
		if key.Kind != yaml.ScalarNode || key.Tag != "!!str" || key.Value == "" {
			return fmt.Errorf("validate nimiapp declaration desktop key: %w", ErrInvalidPackage)
		}
		if _, dup := seenDesktop[key.Value]; dup {
			return fmt.Errorf("validate duplicate nimiapp declaration desktop key %s: %w", key.Value, ErrInvalidPackage)
		}
		seenDesktop[key.Value] = struct{}{}
		if key.Value != "window" {
			return fmt.Errorf("validate unknown nimiapp declaration desktop key %s: %w", key.Value, ErrInvalidPackage)
		}
		windowNode = value
	}
	if windowNode == nil {
		return nil
	}
	if windowNode.Kind != yaml.MappingNode {
		return fmt.Errorf("validate nimiapp declaration desktop.window: %w", ErrInvalidPackage)
	}
	width := defaultWindowWidth
	height := defaultWindowHeight
	minWidth := defaultWindowMinWidth
	minHeight := defaultWindowMinHeight
	seenWindow := make(map[string]struct{}, len(windowNode.Content)/2)
	for index := 0; index < len(windowNode.Content); index += 2 {
		key := windowNode.Content[index]
		value := windowNode.Content[index+1]
		if key.Kind != yaml.ScalarNode || key.Tag != "!!str" || key.Value == "" {
			return fmt.Errorf("validate nimiapp declaration desktop.window key: %w", ErrInvalidPackage)
		}
		if _, dup := seenWindow[key.Value]; dup {
			return fmt.Errorf("validate duplicate nimiapp declaration desktop.window key %s: %w", key.Value, ErrInvalidPackage)
		}
		seenWindow[key.Value] = struct{}{}
		switch key.Value {
		case "width":
			parsed, ok := parseBoundedYAMLInt(value, 400, 2560)
			if !ok {
				return fmt.Errorf("validate nimiapp declaration desktop.window.width: %w", ErrInvalidPackage)
			}
			width = parsed
		case "height":
			parsed, ok := parseBoundedYAMLInt(value, 360, 1600)
			if !ok {
				return fmt.Errorf("validate nimiapp declaration desktop.window.height: %w", ErrInvalidPackage)
			}
			height = parsed
		case "min_width":
			parsed, ok := parseBoundedYAMLInt(value, 320, 1280)
			if !ok {
				return fmt.Errorf("validate nimiapp declaration desktop.window.min_width: %w", ErrInvalidPackage)
			}
			minWidth = parsed
		case "min_height":
			parsed, ok := parseBoundedYAMLInt(value, 320, 960)
			if !ok {
				return fmt.Errorf("validate nimiapp declaration desktop.window.min_height: %w", ErrInvalidPackage)
			}
			minHeight = parsed
		case "title_bar_style":
			if value.Kind != yaml.ScalarNode || value.Tag != "!!str" || (value.Value != "native" && value.Value != "hidden") {
				return fmt.Errorf("validate nimiapp declaration desktop.window.title_bar_style: %w", ErrInvalidPackage)
			}
		default:
			return fmt.Errorf("validate unknown nimiapp declaration desktop.window key %s: %w", key.Value, ErrInvalidPackage)
		}
	}
	if minWidth > width || minHeight > height {
		return fmt.Errorf("validate nimiapp declaration desktop.window bounds: %w", ErrInvalidPackage)
	}
	return nil
}

func mappingValueNode(node *yaml.Node, target string) (*yaml.Node, bool) {
	if node == nil || node.Kind != yaml.MappingNode {
		return nil, false
	}
	for index := 0; index < len(node.Content); index += 2 {
		if node.Content[index].Kind == yaml.ScalarNode && node.Content[index].Value == target {
			return node.Content[index+1], true
		}
	}
	return nil, false
}

func parseBoundedYAMLInt(node *yaml.Node, minValue, maxValue int) (int, bool) {
	if node == nil || node.Kind != yaml.ScalarNode || node.Tag != "!!int" {
		return 0, false
	}
	parsed, err := strconv.Atoi(node.Value)
	if err != nil || parsed < minValue || parsed > maxValue {
		return 0, false
	}
	return parsed, true
}

// digestArchiveRoot derives the exact PayloadRootSHA256 and HostExecutableSHA256
// directly from the verified canonical ZIP entries using the identical framing
// and UTF-8 byte sort order as digestMaterializedRoot, closing staging-tree tampering.
func digestArchiveRoot(ctx context.Context, archive *canonicalZipArchive, targetOS, runtimeEntry string) ([sha256.Size]byte, [sha256.Size]byte, error) {
	if archive == nil {
		return [sha256.Size]byte{}, [sha256.Size]byte{}, ErrPackageIntegrity
	}
	tree := sha256.New()
	_, _ = tree.Write([]byte(payloadDigestDomain))
	if targetOS == "macos" {
		_, _ = tree.Write([]byte("macos\x00"))
	}
	var hostDigest [sha256.Size]byte
	host := sha256.New()
	buffer := make([]byte, 128*1024)
	for _, entry := range archive.entries {
		if targetOS == "macos" {
			kind := byte(0)
			if entry.Mode&os.ModeSymlink != 0 {
				kind = 1
			}
			_, _ = tree.Write([]byte{kind})
			var mode [4]byte
			permissions := uint32(entry.Mode.Perm())
			if kind == 1 {
				permissions = 0o777
			}
			binary.LittleEndian.PutUint32(mode[:], permissions)
			_, _ = tree.Write(mode[:])
		}
		if entry.UncompressedSize > uint64(mathMaxInt64) {
			return [sha256.Size]byte{}, [sha256.Size]byte{}, ErrPackageIntegrity
		}
		writeDigestHeader(tree, entry.Name, int64(entry.UncompressedSize))
		var destination io.Writer = tree
		if entry.Name == runtimeEntry && entry.Mode&os.ModeSymlink == 0 {
			destination = io.MultiWriter(tree, host)
		}
		if err := copyCanonicalEntry(ctx, archive.ra, entry, destination, buffer); err != nil {
			return [sha256.Size]byte{}, [sha256.Size]byte{}, fmt.Errorf("digest verified archive entry %s: %w", entry.Name, errors.Join(ErrPackageIntegrity, err))
		}
		if entry.Name == runtimeEntry && entry.Mode&os.ModeSymlink == 0 {
			copy(hostDigest[:], host.Sum(nil))
		}
	}
	if hostDigest == ([sha256.Size]byte{}) {
		return [sha256.Size]byte{}, [sha256.Size]byte{}, fmt.Errorf("digest archive Runtime entry: %w", ErrPackageIntegrity)
	}
	var treeDigest [sha256.Size]byte
	copy(treeDigest[:], tree.Sum(nil))
	return treeDigest, hostDigest, nil
}

const mathMaxInt64 = int64(^uint64(0) >> 1)
