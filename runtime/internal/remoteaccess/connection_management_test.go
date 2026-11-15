package remoteaccess

import (
	"context"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/pion/webrtc/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func managementPeer(t *testing.T, scope localappkernel.RemoteAccessScope, generation uint64) *Peer {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	p := &Peer{ctx: ctx, cancel: cancel, pc: pc, ready: true, connectedAt: time.Now().UTC(),
		info: PeerInfo{Scope: scope, AccountGeneration: generation, Deadline: time.Now().Add(time.Minute),
			Source: localappkernel.RemoteSource{ClientID: "same.web.source"}}, calls: make(map[uint32]context.CancelFunc)}
	t.Cleanup(p.Close)
	return p
}

func TestConnectionSelectionAndCloseLeaveOtherClientsUsable(t *testing.T) {
	scope := localappkernel.RemoteAccessScope{RealmEnvironmentID: "realm", AccountID: "account", BindingID: "binding"}
	first, second := managementPeer(t, scope, 3), managementPeer(t, scope, 3)
	call, cancelCall := context.WithCancel(first.ctx)
	first.calls[1] = cancelCall
	run := &hostRun{ctx: context.Background(), scope: scope, peers: map[string]*Peer{"first": first, "second": second},
		pending: map[string]pendingOffer{"first": {}, "second": {}}}
	s := &Service{run: run}
	for _, different := range []localappkernel.RemoteAccessScope{
		{RealmEnvironmentID: "other", AccountID: scope.AccountID, BindingID: scope.BindingID},
		{RealmEnvironmentID: scope.RealmEnvironmentID, AccountID: "other", BindingID: scope.BindingID},
		{RealmEnvironmentID: scope.RealmEnvironmentID, AccountID: scope.AccountID, BindingID: "other"},
	} {
		if _, err := s.takeConnection(different, 3, "first"); status.Code(err) != codes.PermissionDenied {
			t.Fatalf("accepted another owner or primary binding: %v", err)
		}
	}
	if _, err := s.takeConnection(scope, 4, "first"); status.Code(err) != codes.NotFound {
		t.Fatal("accepted another Account generation", err)
	}
	if len(run.peers) != 2 || !first.Ready() || !second.Ready() {
		t.Fatal("a rejected operation changed connections")
	}
	selected, err := s.takeConnection(scope, 3, "first")
	if err != nil || selected != first {
		t.Fatal("did not select the exact requested connection", err)
	}
	selected.Close()
	select {
	case <-call.Done():
	default:
		t.Fatal("selected connection retained an active call")
	}
	if first.Ready() || !second.Ready() || len(run.peers) != 1 || run.peers["second"] != second || len(run.pending) != 1 {
		t.Fatal("ending one connection changed another client of the same source")
	}
	third := managementPeer(t, scope, 3)
	run.peers["new-connection"] = third
	if _, err = s.takeConnection(scope, 3, "first"); status.Code(err) != codes.NotFound || !third.Ready() {
		t.Fatal("an old reference ended a later connection", err)
	}
}

func TestConnectionProjectionRequiresEstablishedLivePeer(t *testing.T) {
	p := managementPeer(t, localappkernel.RemoteAccessScope{AccountID: "account"}, 3)
	info, connectedAt, ready := p.ConnectionSnapshot()
	if !ready || connectedAt.IsZero() || info.Source.ClientID != "same.web.source" {
		t.Fatal("live connection facts missing")
	}
	p.ready = false
	if _, _, ready = p.ConnectionSnapshot(); ready {
		t.Fatal("negotiation reported an established connection")
	}
	p.ready = true
	invalidated := make(chan struct{})
	p.info.AccountInvalidated = invalidated
	close(invalidated)
	if _, _, ready = p.ConnectionSnapshot(); ready {
		t.Fatal("invalidated Account remained connected")
	}
}
