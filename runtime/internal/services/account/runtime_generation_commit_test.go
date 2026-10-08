package account

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAuthenticatedGenerationCommitOrdersIdentityMutation(t *testing.T) {
	for _, mutation := range []string{"logout", "replace"} {
		for _, commitFirst := range []bool{false, true} {
			t.Run(mutation+map[bool]string{false: "/mutation-first", true: "/commit-first"}[commitFirst], func(t *testing.T) {
				s := newHarnessService(t, nil)
				completeLogin(t, s)
				projection, generation, _, ok := s.BindAuthenticatedRuntimeGeneration(context.Background())
				if !ok {
					t.Fatal("missing authenticated owner")
				}
				mutate := func() {
					if mutation == "logout" {
						response, err := s.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
						if err != nil || !response.GetAccepted() {
							t.Errorf("logout: %v %v", response, err)
						}
					} else {
						s.mu.Lock()
						if !s.installAuthenticatedRuntimeIdentityLocked(testMaterial("acct-next", "access-next", "refresh-next")) {
							t.Error("identity replacement failed")
						}
						s.mu.Unlock()
					}
				}
				published := false
				if !commitFirst {
					mutate()
					accepted, err := s.CommitAuthenticatedRuntimeGeneration(context.Background(), projection.AccountId, projection.RealmEnvironmentId, generation, func() error { published = true; return nil })
					if accepted || err != nil || published {
						t.Fatal("old generation published after identity mutation", accepted, err)
					}
					return
				}
				entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan struct{})
				go func() {
					defer close(finished)
					accepted, err := s.CommitAuthenticatedRuntimeGeneration(context.Background(), projection.AccountId, projection.RealmEnvironmentId, generation, func() error { close(entered); <-release; published = true; return nil })
					if !accepted || err != nil {
						t.Errorf("commit: %v %v", accepted, err)
					}
				}()
				<-entered
				mutated := make(chan struct{})
				go func() { defer close(mutated); mutate() }()
				select {
				case <-mutated:
					t.Error("identity mutation overtook held commit")
				case <-time.After(20 * time.Millisecond):
				}
				close(release)
				<-finished
				<-mutated
				if !published {
					t.Fatal("valid preceding publication lost")
				}
			})
		}
	}
}
