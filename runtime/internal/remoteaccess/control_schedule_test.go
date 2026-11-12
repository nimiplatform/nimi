package remoteaccess

import (
	"context"
	"testing"
	"time"

	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/pion/webrtc/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestNewPeerRequestsAuthorizationBeforeLateOfferExpires(t *testing.T) {
	for _, verified := range []bool{false, true} {
		t.Run(map[bool]string{false: "validation-fails", true: "validation-succeeds"}[verified], func(t *testing.T) {
			now := time.Now()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
			if err != nil {
				t.Fatal(err)
			}
			originalDeadline := now.Add(200 * time.Millisecond)
			peer := &Peer{ctx: ctx, cancel: cancel, pc: pc, info: PeerInfo{
				ContextID: "context", Deadline: originalDeadline,
				Source: localappkernel.RemoteSource{ClientID: "app", SourceRevision: 1, Role: "app", Origin: "https://app.example", RedirectURI: "https://app.example/"},
			}}
			defer peer.Close()
			run := &hostRun{ctx: ctx, peers: make(map[string]*Peer), pending: map[string]pendingOffer{"connection": {deadline: originalDeadline}}, nextSync: now.Add(activeSyncInterval)}
			service := &Service{run: run, wake: make(chan struct{}, 1)}
			service.publishPeer(run, ctx, "connection", peer)
			select {
			case <-service.wake:
			default:
				t.Fatal("new peer did not wake control loop")
			}
			if !run.syncDue(now, true, false) {
				t.Fatal("new peer waits for the regular sync interval")
			}
			if !peer.info.Deadline.Equal(originalDeadline) {
				t.Fatal("publishing extended authority without validation")
			}
			if verified {
				service.applySync(run, &accountservice.PrimaryRuntimeSync{
					ObservedAt: now, AuthorityDeadline: now.Add(time.Minute),
					Projection: &realmv1.RuntimeConnectionSyncResultDto{ServerTime: now.UTC().Format(time.RFC3339Nano),
						Contexts: []realmv1.RuntimeClientContextDto{{ContextId: "context", ExpiresAt: now.Add(time.Hour).UTC().Format(time.RFC3339Nano),
							Source: &realmv1.RuntimeClientSourceDto{ClientId: "app", SourceRevision: 1, Role: "app", Origin: "https://app.example", RedirectUri: "https://app.example/"}}}},
				})
			} else {
				run.syncRetry.failed(now)
				service.controlFailure(run, "REALM_UNAVAILABLE", status.Error(codes.Unavailable, "sync unavailable"))
				if run.syncDue(now, true, true) {
					t.Fatal("failed validation bypassed retry delay")
				}
			}
			time.Sleep(time.Until(originalDeadline) + 20*time.Millisecond)
			if peer.Live() != verified {
				t.Fatal("peer lifetime did not follow validated authorization")
			}
		})
	}
}

func TestControlFailureBackoffGatesDirtyAndForcedSync(t *testing.T) {
	now := time.Now()
	run := &hostRun{forceSync: true}
	for _, delay := range []time.Duration{5, 10, 20, 30, 30} {
		run.nextSync = now.Add(activeSyncInterval)
		run.syncRetry.failed(now)
		run.heartbeatRetry.failed(now)
		beforeRetry := now.Add(delay*time.Second - time.Nanosecond)
		if run.syncDue(beforeRetry, true, true) || run.heartbeatRetry.ready(beforeRetry) {
			t.Fatal("control operation bypassed its failure backoff")
		}
		now = now.Add(delay * time.Second)
		if !run.syncDue(now, true, true) {
			t.Fatal("retry never became eligible")
		}
		run.forceSync = false
		if !run.syncDue(now, true, false) {
			t.Fatal("active authorization retry waited for the normal interval")
		}
		if run.syncDue(now, false, false) {
			t.Fatal("retry continued after all demand ended")
		}
	}
	run.syncRetry.failed(now)
	run.heartbeatRetry = controlRetry{}
	if run.syncDue(now, true, true) {
		t.Fatal("heartbeat success bypassed sync backoff")
	}
	run.syncRetry = controlRetry{}
	run.forceSync = false
	run.nextSync = now.Add(activeSyncInterval)
	if run.syncDue(now, false, false) || run.syncDue(now, true, false) {
		t.Fatal("success did not return to normal cadence")
	}
	if !run.syncDue(now, false, true) {
		t.Fatal("new signal did not trigger sync after recovery")
	}
}
