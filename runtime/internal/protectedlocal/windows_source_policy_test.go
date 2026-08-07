package protectedlocal

import (
	"strings"
	"testing"
)

func TestWindowsSourcePipePolicyIsPerUserAndRoleSeparated(t *testing.T) {
	const sid = "S-1-5-21-111-222-333-1001"
	desktop, err := windowsSourceLocalDevelopmentPipeName(sid, windowsSourceDesktopPipeRole)
	if err != nil {
		t.Fatalf("desktop pipe name: %v", err)
	}
	localApp, err := windowsSourceLocalDevelopmentPipeName(sid, windowsSourceLocalAppPipeRole)
	if err != nil {
		t.Fatalf("local-app pipe name: %v", err)
	}
	if desktop == localApp || strings.Contains(desktop, sid) || strings.Contains(localApp, sid) {
		t.Fatal("per-user pipe names must be role-separated without exposing the SID")
	}
	if desktop != `\\.\pipe\nimi-runtime-source-local-development-2d86a31e23d85201c8e09da5ae76b4839ae5d62e6db744f4ae1f1a5640bbc0da-desktop-v1` {
		t.Fatalf("desktop pipe name = %q", desktop)
	}
	if _, err := windowsSourceLocalDevelopmentPipeName(sid, "other"); err == nil {
		t.Fatal("unknown pipe role was admitted")
	}
}

func TestWindowsSourcePipeACLPolicyIsOwnerOnly(t *testing.T) {
	const sid = "S-1-5-21-111-222-333-1001"
	sddl, err := windowsSourceOwnerOnlyPipeSDDL(sid)
	if err != nil || sddl != "O:"+sid+"D:P(A;;GA;;;"+sid+")" {
		t.Fatalf("owner-only SDDL = %q, %v", sddl, err)
	}
	valid := []windowsSourceACLPolicyEntry{{Principal: sid, Allow: true, FullControl: true}}
	if err := validateWindowsSourceOwnerOnlyACLPolicy(sid, valid); err != nil {
		t.Fatalf("owner-only ACL: %v", err)
	}
	for name, entries := range map[string][]windowsSourceACLPolicyEntry{
		"second principal": append(append([]windowsSourceACLPolicyEntry{}, valid...), windowsSourceACLPolicyEntry{Principal: "S-1-5-18", Allow: true, FullControl: true}),
		"inherited":        {{Principal: sid, Allow: true, Inherited: true, FullControl: true}},
		"partial":          {{Principal: sid, Allow: true}},
		"deny":             {{Principal: sid, FullControl: true}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateWindowsSourceOwnerOnlyACLPolicy(sid, entries); err == nil {
				t.Fatal("non-owner-only ACL was admitted")
			}
		})
	}
}
