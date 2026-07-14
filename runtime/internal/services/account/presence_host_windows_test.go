//go:build windows

package account

import (
	"os"
	"strings"
	"testing"
)

func TestWindowsHostPresenceProviderUsesHelloPinVerifier(t *testing.T) {
	source, err := os.ReadFile("presence_host_windows.go")
	if err != nil {
		t.Fatalf("read windows provider source: %v", err)
	}
	text := string(source)
	for _, forbidden := range []string{
		"CredUIPromptForWindowsCredentials",
		"CredUnPackAuthenticationBuffer",
		"LogonUser",
		"Confirm your Windows credentials",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("windows presence provider still contains username/password credential path %q", forbidden)
		}
	}
	if !strings.Contains(text, "UserConsentVerifier") {
		t.Fatalf("windows presence provider must call Windows Hello/PIN UserConsentVerifier")
	}
	for _, required := range []string{
		"WTSGetActiveConsoleSessionId",
		"WTSQueryUserToken",
		"CreateProcessAsUser",
		`winsta0\default`,
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("windows service presence provider must bind the interactive session through %q", required)
		}
	}
	if strings.Contains(text, "exec.CommandContext") {
		t.Fatalf("windows service presence must not launch the verifier inside service Session 0")
	}
}
