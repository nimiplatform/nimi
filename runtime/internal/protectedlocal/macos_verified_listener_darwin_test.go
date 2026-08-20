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

func testMacOSVerifiedDesktopConnection(
	t *testing.T,
	listener *MacOSVerifiedDesktopListener,
	peer DesktopPeerIdentity,
) *macOSVerifiedDesktopNetConn {
	t.Helper()
	connection, err := newDirectDesktopConnection(peer, nil)
	if err != nil {
		t.Fatalf("create verified Desktop connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return &macOSVerifiedDesktopNetConn{connection: connection, listener: listener}
}
