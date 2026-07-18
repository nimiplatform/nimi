package protectedlocal

import "testing"

func TestAbsolutePlatformPathUsesRecordPlatformSemantics(t *testing.T) {
	t.Parallel()
	accepted := []struct {
		os   OperatingSystem
		path string
	}{
		{OSMacOS, "/Applications/Nimi.app/Contents/MacOS/Nimi"},
		{OSLinux, "/usr/libexec/nimi-runtime"},
		{OSWindows, `C:\Program Files\Nimi\Nimi.exe`},
		{OSWindows, `C:\`},
		{OSWindows, `\\server\share\Nimi\Nimi.exe`},
		{OSWindows, `\\?\C:\Program Files\Nimi\Nimi.exe`},
		{OSWindows, `\\?\UNC\server\share\Nimi\Nimi.exe`},
	}
	for _, testCase := range accepted {
		if !IsAbsolutePathForOperatingSystem(testCase.os, testCase.path) {
			t.Fatalf("expected %s path to be accepted: %q", testCase.os, testCase.path)
		}
		if !IsAbsolutePlatformPath(testCase.path) {
			t.Fatalf("expected platform path to be accepted: %q", testCase.path)
		}
	}
}

func TestAbsolutePlatformPathRejectsRelativeOrNonCanonicalForms(t *testing.T) {
	t.Parallel()
	rejected := []struct {
		os   OperatingSystem
		path string
	}{
		{OSMacOS, "Applications/Nimi.app"},
		{OSMacOS, "/Applications/../tmp/Nimi.app"},
		{OSMacOS, "/Applications/Nimi.app/"},
		{OSWindows, `C:Nimi.exe`},
		{OSWindows, `C:/Nimi/Nimi.exe`},
		{OSWindows, `C:\Nimi\..\Nimi.exe`},
		{OSWindows, `C:\Nimi\\Nimi.exe`},
		{OSWindows, `\\server`},
		{OSWindows, `\\.\pipe\nimi`},
		{OperatingSystem("unknown"), "/absolute"},
		{OSMacOS, "/tmp/nimi\x00"},
	}
	for _, testCase := range rejected {
		if IsAbsolutePathForOperatingSystem(testCase.os, testCase.path) {
			t.Fatalf("expected %s path to be rejected: %q", testCase.os, testCase.path)
		}
	}
}
