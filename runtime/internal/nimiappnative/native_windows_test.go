//go:build windows

package nimiappnative

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

type testPEOptions struct {
	platform string
	level    string
	manifest bool
	uiAccess bool
}

type powershellSignature struct {
	Status  string  `json:"status"`
	Type    string  `json:"type"`
	Subject *string `json:"subject"`
}

func TestVerifyWindowsRuntimeEntryAcceptsRealUnsignedAsInvokerPE(t *testing.T) {
	path := compileTestPE(t, testPEOptions{platform: "x64", level: "asInvoker", manifest: true})
	digest := testFileSHA256(t, path)
	observation, err := VerifyWindowsRuntimeEntry(context.Background(), path, unsignedExpectation(), digest)
	if err != nil {
		t.Fatal(err)
	}
	if observation.Arch != "x86_64" || observation.WindowsCodeSigning != "unsigned" ||
		observation.CertificateSubject != nil || observation.RequestedExecutionLevel != "asInvoker" ||
		observation.UIAccess || observation.HostExecutableSHA256 != digest {
		t.Fatalf("observation = %+v", observation)
	}
	subject := "CN=Unrelated"
	publisher := "publisher"
	signed := unsignedExpectation()
	signed.WindowsCodeSigning = "signed"
	signed.SigningSubject = &publisher
	signed.ObservedSubject = &subject
	if _, err := VerifyWindowsRuntimeEntry(context.Background(), path, signed, digest); !errors.Is(err, ErrNativePostureMismatch) {
		t.Fatalf("unsigned executable against signed descriptor error = %v", err)
	}
	wrongDigest := digest
	wrongDigest[0] ^= 0xff
	if _, err := VerifyWindowsRuntimeEntry(context.Background(), path, unsignedExpectation(), wrongDigest); !errors.Is(err, ErrNativeVerification) {
		t.Fatalf("wrong digest error = %v", err)
	}
}

func TestVerifyWindowsRuntimeEntryRejectsWrongPEAndExecutionProfiles(t *testing.T) {
	tests := []struct {
		name   string
		build  testPEOptions
		mutate func(*testing.T, string)
	}{
		{name: "x86", build: testPEOptions{platform: "x86", level: "asInvoker", manifest: true}},
		{name: "missing manifest", build: testPEOptions{platform: "x64", manifest: false}},
		{name: "highest available", build: testPEOptions{platform: "x64", level: "highestAvailable", manifest: true}},
		{name: "requires administrator", build: testPEOptions{platform: "x64", level: "requireAdministrator", manifest: true}},
		{name: "UI Access", build: testPEOptions{platform: "x64", level: "asInvoker", manifest: true, uiAccess: true}},
		{name: "DLL characteristic", build: testPEOptions{platform: "x64", level: "asInvoker", manifest: true}, mutate: func(t *testing.T, path string) {
			patchTestPEUint16(t, path, 22, func(value uint16) uint16 { return value | windowsPECharacteristicDLL })
		}},
		{name: "system characteristic", build: testPEOptions{platform: "x64", level: "asInvoker", manifest: true}, mutate: func(t *testing.T, path string) {
			patchTestPEUint16(t, path, 22, func(value uint16) uint16 { return value | windowsPECharacteristicSystem })
		}},
		{name: "unsupported subsystem", build: testPEOptions{platform: "x64", level: "asInvoker", manifest: true}, mutate: func(t *testing.T, path string) {
			patchTestPEUint16(t, path, 24+68, func(uint16) uint16 { return 1 })
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := compileTestPE(t, test.build)
			if test.mutate != nil {
				test.mutate(t, path)
			}
			if _, err := VerifyWindowsRuntimeEntry(
				context.Background(), path, unsignedExpectation(), testFileSHA256(t, path),
			); !errors.Is(err, ErrNativeVerification) {
				t.Fatalf("invalid PE error = %v", err)
			}
		})
	}
}

func TestVerifyWindowsRuntimeEntryPreservesRealEmbeddedSignerAndRejectsTamper(t *testing.T) {
	signedPath, nativeObservation := findSignedEmbeddedTestPE(t)
	powershell := observePowerShellSignature(t, signedPath)
	if powershell.Status != "Valid" || powershell.Type != "Authenticode" || powershell.Subject == nil ||
		nativeObservation.CertificateSubject == nil || *nativeObservation.CertificateSubject != *powershell.Subject {
		t.Fatalf("native=%+v PowerShell=%+v", nativeObservation, powershell)
	}
	publisher := "publisher"
	expected := WindowsExpectation{
		Arch: "x86_64", ExecutionProfileRef: WindowsExecutionProfileRef,
		WindowsCodeSigning: "signed", SigningSubject: &publisher, ObservedSubject: powershell.Subject,
	}
	if _, err := VerifyWindowsRuntimeEntry(
		context.Background(), signedPath, expected, testFileSHA256(t, signedPath),
	); err != nil {
		t.Fatal(err)
	}

	tamperedPath := filepath.Join(t.TempDir(), "tampered.exe")
	raw, err := os.ReadFile(signedPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tamperedPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	tamperTestPECodeSection(t, tamperedPath)
	if _, err := VerifyWindowsRuntimeEntry(
		context.Background(), tamperedPath, expected, testFileSHA256(t, tamperedPath),
	); !errors.Is(err, ErrNativeVerification) {
		t.Fatalf("tampered signed PE error = %v", err)
	}
}

func TestVerifyWindowsRuntimeEntryRejectsCatalogSignedPE(t *testing.T) {
	systemDirectory, err := windows.GetSystemDirectory()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(systemDirectory, "cmd.exe")
	signature := observePowerShellSignature(t, path)
	if signature.Status != "Valid" || signature.Type != "Catalog" {
		t.Fatalf("cmd.exe is not the expected real catalog fixture: %+v", signature)
	}
	if _, err := VerifyWindowsRuntimeEntry(
		context.Background(), path, unsignedExpectation(), testFileSHA256(t, path),
	); !errors.Is(err, ErrNativeVerification) {
		t.Fatalf("catalog-signed PE error = %v", err)
	}
}

func TestWindowsRuntimeEntryVerificationHonorsCanceledContext(t *testing.T) {
	path := compileTestPE(t, testPEOptions{platform: "x64", level: "asInvoker", manifest: true})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := VerifyWindowsRuntimeEntry(ctx, path, unsignedExpectation(), testFileSHA256(t, path)); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled verification error = %v", err)
	}
}

func unsignedExpectation() WindowsExpectation {
	return WindowsExpectation{
		Arch: "x86_64", ExecutionProfileRef: WindowsExecutionProfileRef, WindowsCodeSigning: "unsigned",
	}
}

func compileTestPE(t *testing.T, options testPEOptions) string {
	t.Helper()
	windowsDirectory, err := windows.GetSystemWindowsDirectory()
	if err != nil {
		t.Fatal(err)
	}
	compilers := []string{
		filepath.Join(windowsDirectory, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
		filepath.Join(windowsDirectory, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
	}
	compiler := ""
	for _, candidate := range compilers {
		if _, err := os.Stat(candidate); err == nil {
			compiler = candidate
			break
		}
	}
	if compiler == "" {
		t.Fatal("a real Windows C# compiler is required")
	}
	root := t.TempDir()
	executablePath := filepath.Join(root, "fixture.exe")
	sourcePath := filepath.Join(root, "Program.cs")
	if err := os.WriteFile(sourcePath, []byte("internal static class Program { [System.STAThread] private static void Main() {} }\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	args := []string{"/nologo", "/target:winexe", "/platform:" + options.platform, "/out:" + executablePath}
	if options.manifest {
		manifestPath := filepath.Join(root, "app.manifest")
		manifest := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges>
      <requestedExecutionLevel level="%s" uiAccess="%t" />
    </requestedPrivileges></security>
  </trustInfo>
</assembly>
`, options.level, options.uiAccess)
		if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
			t.Fatal(err)
		}
		args = append(args, "/win32manifest:"+manifestPath)
	} else {
		args = append(args, "/nowin32manifest")
	}
	args = append(args, sourcePath)
	command := exec.Command(compiler, args...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("compile test PE: %v\n%s", err, output)
	}
	return executablePath
}

func findSignedEmbeddedTestPE(t *testing.T) (string, WindowsObservation) {
	t.Helper()
	candidates := []string{
		filepath.Join(os.Getenv("ProgramFiles"), "Git", "cmd", "git.exe"),
		filepath.Join(os.Getenv("ProgramFiles"), "PowerShell", "7", "pwsh.exe"),
	}
	if node, err := exec.LookPath("node.exe"); err == nil {
		candidates = append(candidates, node)
	}
	var failures []string
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err != nil {
			continue
		}
		digest := testFileSHA256(t, candidate)
		observation, err := verifyWindowsRuntimeEntry(context.Background(), candidate, digest)
		if err == nil && observation.WindowsCodeSigning == "signed" && observation.CertificateSubject != nil {
			return candidate, observation
		}
		failures = append(failures, fmt.Sprintf("%s: %v", candidate, err))
	}
	t.Fatalf("no real embedded-signed asInvoker Windows PE is available:\n%s", strings.Join(failures, "\n"))
	return "", WindowsObservation{}
}

func observePowerShellSignature(t *testing.T, executablePath string) powershellSignature {
	t.Helper()
	systemDirectory, err := windows.GetSystemDirectory()
	if err != nil {
		t.Fatal(err)
	}
	powershell := filepath.Join(systemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe")
	script := `$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:NIMI_TEST_EXECUTABLE; [pscustomobject]@{status=[string]$s.Status;type=[string]$s.SignatureType;subject=$(if($null -eq $s.SignerCertificate){$null}else{[string]$s.SignerCertificate.Subject})}|ConvertTo-Json -Compress`
	command := exec.Command(powershell, "-NoProfile", "-NonInteractive", "-Command", script)
	command.Env = append(withoutEnvironmentKey(os.Environ(), "PSModulePath"), "NIMI_TEST_EXECUTABLE="+executablePath)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("observe PowerShell signature: %v\n%s", err, output)
	}
	var result powershellSignature
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("decode PowerShell signature: %v\n%s", err, output)
	}
	return result
}

func withoutEnvironmentKey(environment []string, key string) []string {
	prefix := strings.ToLower(key) + "="
	result := make([]string, 0, len(environment))
	for _, item := range environment {
		if !strings.HasPrefix(strings.ToLower(item), prefix) {
			result = append(result, item)
		}
	}
	return result
}

func testFileSHA256(t *testing.T, path string) [sha256.Size]byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(raw)
}

func patchTestPEUint16(t *testing.T, path string, offsetFromPE int, update func(uint16) uint16) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	peOffset := int(binary.LittleEndian.Uint32(raw[0x3c:]))
	offset := peOffset + offsetFromPE
	binary.LittleEndian.PutUint16(raw[offset:offset+2], update(binary.LittleEndian.Uint16(raw[offset:offset+2])))
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func tamperTestPECodeSection(t *testing.T, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	peOffset := int(binary.LittleEndian.Uint32(raw[0x3c:]))
	sectionCount := int(binary.LittleEndian.Uint16(raw[peOffset+6 : peOffset+8]))
	optionalHeaderSize := int(binary.LittleEndian.Uint16(raw[peOffset+20 : peOffset+22]))
	sectionTable := peOffset + 24 + optionalHeaderSize
	for index := 0; index < sectionCount; index++ {
		section := sectionTable + index*40
		size := int(binary.LittleEndian.Uint32(raw[section+16 : section+20]))
		offset := int(binary.LittleEndian.Uint32(raw[section+20 : section+24]))
		characteristics := binary.LittleEndian.Uint32(raw[section+36 : section+40])
		if characteristics&0x20 != 0 && size > 0 && offset+size <= len(raw) {
			raw[offset+min(16, size-1)] ^= 0x01
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			return
		}
	}
	t.Fatal("signed PE has no bounded code section")
}
