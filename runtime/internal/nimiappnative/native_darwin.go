package nimiappnative

import (
	"context"
	"crypto/sha256"
	"debug/macho"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-024b
func verifyMacOSRuntimeEntry(ctx context.Context, executablePath string, expectedDigest [sha256.Size]byte) (MacOSObservation, error) {
	info, err := os.Lstat(executablePath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 || info.Mode().Perm()&0o111 == 0 {
		return MacOSObservation{}, errors.Join(ErrNativeVerification, err)
	}
	contents := filepath.Dir(filepath.Dir(executablePath))
	bundle := filepath.Dir(contents)
	if filepath.Base(filepath.Dir(executablePath)) != "MacOS" || filepath.Base(contents) != "Contents" || !strings.HasSuffix(bundle, ".app") {
		return MacOSObservation{}, ErrNativeVerification
	}
	bytes, err := os.ReadFile(executablePath)
	if err != nil || sha256.Sum256(bytes) != expectedDigest {
		return MacOSObservation{}, errors.Join(ErrNativeVerification, err)
	}
	native, err := macho.Open(executablePath)
	if err != nil {
		return MacOSObservation{}, errors.Join(ErrNativeVerification, err)
	}
	defer func() { _ = native.Close() }()
	if native.Cpu != macho.CpuArm64 || native.Type != macho.TypeExec {
		return MacOSObservation{}, ErrNativeVerification
	}
	signaturePresent := false
	for _, load := range native.Loads {
		raw := load.Raw()
		if len(raw) >= 4 && native.ByteOrder.Uint32(raw[:4]) == 0x1d {
			if signaturePresent || len(raw) != 16 {
				return MacOSObservation{}, ErrNativeVerification
			}
			offset, size := binary.LittleEndian.Uint32(raw[8:12]), binary.LittleEndian.Uint32(raw[12:16])
			if size == 0 || uint64(offset)+uint64(size) > uint64(len(bytes)) {
				return MacOSObservation{}, ErrNativeVerification
			}
			signaturePresent = true
		}
	}
	infoJSON, err := macOSNativeCommand(ctx, "/usr/bin/plutil", "-convert", "json", "-o", "-", filepath.Join(contents, "Info.plist"))
	if err != nil {
		return MacOSObservation{}, err
	}
	var bundleInfo map[string]json.RawMessage
	if err := json.Unmarshal(infoJSON, &bundleInfo); err != nil {
		return MacOSObservation{}, errors.Join(ErrNativeVerification, err)
	}
	var entryName string
	if err := json.Unmarshal(bundleInfo["CFBundleExecutable"], &entryName); err != nil || entryName != filepath.Base(executablePath) {
		return MacOSObservation{}, ErrNativeVerification
	}
	if _, privileged := bundleInfo["SMPrivilegedExecutables"]; privileged {
		return MacOSObservation{}, ErrNativeVerification
	}
	if _, err := os.Lstat(filepath.Join(contents, "Library", "LaunchDaemons")); !errors.Is(err, os.ErrNotExist) {
		return MacOSObservation{}, errors.Join(ErrNativeVerification, err)
	}
	details, detailErr := macOSNativeCommand(ctx, "/usr/bin/codesign", "--display", "--verbose=4", bundle)
	observed := MacOSObservation{Notarization: "absent", HostExecutableSHA256: expectedDigest}
	if !signaturePresent {
		if detailErr == nil || !strings.Contains(string(details), "code object is not signed at all") {
			return MacOSObservation{}, errors.Join(ErrNativeVerification, detailErr)
		}
		return observed, nil
	}
	if detailErr != nil {
		return MacOSObservation{}, detailErr
	}
	if _, err := macOSNativeCommand(ctx, "/usr/bin/codesign", "--verify", "--deep", "--strict", bundle); err != nil {
		return MacOSObservation{}, err
	}
	if !strings.Contains("\n"+string(details), "\nSignature=adhoc\n") {
		if _, err := macOSNativeCommand(ctx, "/usr/bin/codesign", "--verify", "--strict", "-R=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists", bundle); err != nil {
			return MacOSObservation{}, err
		}
		for _, line := range strings.Split(string(details), "\n") {
			if strings.HasPrefix(line, "Authority=Developer ID Application: ") {
				subject := strings.TrimPrefix(line, "Authority=")
				observed.DeveloperIDSubject = &subject
				break
			}
		}
		if observed.DeveloperIDSubject == nil {
			return MacOSObservation{}, ErrNativeVerification
		}
		ticket, ticketErr := macOSNativeCommand(ctx, "/usr/bin/xcrun", "stapler", "validate", bundle)
		if ticketErr == nil {
			observed.Notarization = "notarized"
		} else if !strings.Contains(string(ticket), "does not have a ticket stapled to it") {
			return MacOSObservation{}, ticketErr
		}
	}
	after, err := os.ReadFile(executablePath)
	if err != nil || sha256.Sum256(after) != expectedDigest {
		return MacOSObservation{}, errors.Join(ErrNativeVerification, err)
	}
	return observed, nil
}

func macOSNativeCommand(ctx context.Context, executable string, args ...string) ([]byte, error) {
	bounded, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	command := exec.CommandContext(bounded, executable, args...)
	output, err := command.CombinedOutput()
	if err != nil {
		return output, fmt.Errorf("macOS native %s: %w: %v: %.2048s", filepath.Base(executable), ErrNativeVerification, err, output)
	}
	return output, nil
}
