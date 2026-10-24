//go:build darwin && cgo

package protectedlocal

import "testing"

func TestMacOSDesktopListenerReplacesOnlyTheSameVerifiedPeer(t *testing.T) {
	listener := &MacOSVerifiedDesktopListener{}
	peer := DesktopPeerIdentity{OS: OSMacOS, PID: 101, UID: 501, AuditSession: 7}
	first := testMacOSVerifiedDesktopConnection(t, listener, peer)
	if replaced, ok := listener.activate(first); !ok || replaced != nil {
		t.Fatal("first verified Desktop connection was not activated")
	}
	firstDone := listener.activeDone

	replacement := testMacOSVerifiedDesktopConnection(t, listener, peer)
	replaced, ok := listener.activate(replacement)
	if !ok || replaced != first || listener.active != replacement {
		t.Fatal("same verified Desktop peer did not replace its stale connection")
	}
	select {
	case <-firstDone:
	default:
		t.Fatal("replaced Desktop connection did not release the active waiter")
	}

	otherPeer := DesktopPeerIdentity{OS: OSMacOS, PID: 102, UID: 501, AuditSession: 7}
	other := testMacOSVerifiedDesktopConnection(t, listener, otherPeer)
	if replaced, ok := listener.activate(other); ok || replaced != nil || listener.active != replacement {
		t.Fatal("different Desktop process replaced the active verified peer")
	}
}

func TestMacOSDesktopReplacementRequiresFullProcessIdentity(t *testing.T) {
	peer := DesktopPeerIdentity{OS: OSMacOS, PID: 101, UID: 501, AuditSession: 7}
	for name, mutate := range map[string]func(*ProcessTuple){
		"creation marker":     func(value *ProcessTuple) { value.CreationMarker += "-changed" },
		"login session":       func(value *ProcessTuple) { value.OSLoginSession += "-changed" },
		"principal":           func(value *ProcessTuple) { value.SecurityPrincipal += "-changed" },
		"executable identity": func(value *ProcessTuple) { value.CanonicalExecutableIdentity += "-changed" },
		"executable path":     func(value *ProcessTuple) { value.CanonicalExecutablePath += "-changed" },
		"digest":              func(value *ProcessTuple) { value.ExecutableDigest[1] ^= 1 },
		"trust set":           func(value *ProcessTuple) { value.ExecutableTrustSetID += "-changed" },
	} {
		t.Run(name, func(t *testing.T) {
			listener := &MacOSVerifiedDesktopListener{}
			current := testMacOSVerifiedDesktopConnection(t, listener, peer)
			if _, ok := listener.activate(current); !ok {
				t.Fatal("initial verified process was rejected")
			}
			activeDone := listener.activeDone
			process, ok := current.connection.ClientProcess()
			if !ok {
				t.Fatal("current verified process has no complete identity")
			}
			mutate(&process)
			candidate, err := newDirectDesktopConnectionWithClient(peer, process, nil)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(candidate.Revoke)
			if replaced, ok := listener.activate(&macOSVerifiedDesktopNetConn{connection: candidate, listener: listener}); ok || replaced != nil || listener.active != current {
				t.Fatal("same PID and audit session hid a changed exact process identity")
			}
			select {
			case <-activeDone:
				t.Fatal("refused replacement changed the current connection lifetime")
			default:
			}
		})
	}
}

func TestMacOSDesktopReplacementRejectsMissingProcessProof(t *testing.T) {
	peer := DesktopPeerIdentity{OS: OSMacOS, PID: 101, UID: 501, AuditSession: 7}
	for _, missing := range []string{"current", "replacement", "both"} {
		t.Run(missing, func(t *testing.T) {
			listener := &MacOSVerifiedDesktopListener{}
			current := testMacOSVerifiedDesktopConnection(t, listener, peer)
			replacement := testMacOSVerifiedDesktopConnection(t, listener, peer)
			withoutProof, err := newDirectDesktopConnection(peer, nil)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(withoutProof.Revoke)
			if missing != "replacement" {
				current.connection = withoutProof
			}
			if missing != "current" {
				replacement.connection = withoutProof
			}
			listener.active = current
			listener.activeDone = make(chan struct{})
			if replaced, ok := listener.activate(replacement); ok || replaced != nil || listener.active != current {
				t.Fatal("minimal peer identity authorized replacement without complete process proof")
			}
		})
	}
}

func TestMacOSDesktopProcessTupleRetainsVerifiedPeerEvidence(t *testing.T) {
	snapshot := macOSProcessSnapshot{
		pid: 101, euid: 501, ruid: 501,
		startSeconds: 100, startMicros: 200,
		executablePath: "/Applications/Nimi.app/Contents/MacOS/Nimi",
	}
	audit := macOSAuditIdentity{pid: 101, euid: 501, auditSession: 7, pidVersion: 9}
	code := macOSCodeIdentity{
		teamID:            "NIMI123456",
		signingIdentifier: "ai.nimi.apps.nimi.desktop",
		cdhash:            "0123456789abcdef",
	}
	tuple, err := macOSDesktopProcessTuple(
		snapshot,
		audit,
		code,
		snapshot.executablePath,
		macOSDesktopSignedTrustSetID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if tuple.OS != OSMacOS || tuple.PID != audit.pid ||
		tuple.CanonicalExecutablePath != snapshot.executablePath ||
		tuple.ExecutableDigest == (Identifier{}) ||
		tuple.ExecutableTrustSetID != macOSDesktopSignedTrustSetID {
		t.Fatalf("unexpected macOS Desktop process tuple: %+v", tuple)
	}
}

func testMacOSVerifiedDesktopConnection(
	t *testing.T,
	listener *MacOSVerifiedDesktopListener,
	peer DesktopPeerIdentity,
) *macOSVerifiedDesktopNetConn {
	t.Helper()
	connection, err := newDirectDesktopConnectionWithClient(peer, ProcessTuple{
		OS: peer.OS, PID: peer.PID,
		CreationMarker:              "macos-start:100:200:pidversion:9",
		OSLoginSession:              "macos-audit-session:7",
		SecurityPrincipal:           "macos-uid:501",
		CanonicalExecutableIdentity: "macos-code:ai.nimi.apps.nimi.desktop:0123456789abcdef",
		CanonicalExecutablePath:     "/Applications/Nimi.app/Contents/MacOS/Nimi",
		ExecutableDigest:            Identifier{1},
		ExecutableTrustSetID:        macOSDesktopSignedTrustSetID,
	}, nil)
	if err != nil {
		t.Fatalf("create verified Desktop connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return &macOSVerifiedDesktopNetConn{connection: connection, listener: listener}
}
