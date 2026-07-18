package protectedlocal

import (
	slashpath "path"
	"strings"
)

// IsAbsolutePlatformPath validates a canonical absolute path without using the
// build host's path rules. Protected-local records can be decoded and audited
// on a different platform, so filepath.IsAbs would make their validity depend
// on whichever OS happened to run the verifier.
func IsAbsolutePlatformPath(value string) bool {
	return IsAbsolutePathForOperatingSystem(OSMacOS, value) ||
		IsAbsolutePathForOperatingSystem(OSLinux, value) ||
		IsAbsolutePathForOperatingSystem(OSWindows, value)
}

// IsAbsolutePathForOperatingSystem validates the lexical canonical form used
// by the named platform. It does not resolve the path or establish file trust;
// native verifiers must still lock and attest the referenced file.
func IsAbsolutePathForOperatingSystem(os OperatingSystem, value string) bool {
	if value == "" || strings.IndexByte(value, 0) >= 0 {
		return false
	}
	switch os {
	case OSMacOS, OSLinux:
		return slashpath.IsAbs(value) && slashpath.Clean(value) == value
	case OSWindows:
		return canonicalWindowsAbsolutePath(value)
	default:
		return false
	}
}

func canonicalWindowsAbsolutePath(value string) bool {
	if strings.Contains(value, "/") {
		return false
	}
	if strings.HasPrefix(value, `\\?\UNC\`) {
		return canonicalWindowsUNC(value[len(`\\?\UNC\`):])
	}
	if strings.HasPrefix(value, `\\?\`) {
		return canonicalWindowsDrive(value[len(`\\?\`):])
	}
	if strings.HasPrefix(value, `\\`) {
		return canonicalWindowsUNC(value[2:])
	}
	return canonicalWindowsDrive(value)
}

func canonicalWindowsDrive(value string) bool {
	if len(value) < 3 || !asciiLetter(value[0]) || value[1] != ':' || value[2] != '\\' {
		return false
	}
	return len(value) == 3 || canonicalWindowsSegments(value[3:])
}

func canonicalWindowsUNC(value string) bool {
	segments := strings.Split(value, `\`)
	if len(segments) < 2 || segments[0] == "" || segments[1] == "" {
		return false
	}
	for _, segment := range segments {
		if !canonicalWindowsSegment(segment) {
			return false
		}
	}
	return true
}

func canonicalWindowsSegments(value string) bool {
	if value == "" {
		return true
	}
	for _, segment := range strings.Split(value, `\`) {
		if !canonicalWindowsSegment(segment) {
			return false
		}
	}
	return true
}

func canonicalWindowsSegment(value string) bool {
	return value != "" && value != "." && value != ".."
}

func asciiLetter(value byte) bool {
	return value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z'
}
