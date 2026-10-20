package runtimeagent

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"testing"
	"time"
)

func TestForegroundWaitsForActualBackgroundRelease(t *testing.T) {
	s := newRuntimeAgentServiceForPublicChatTest(t)
	ref := testRuntimeAgentLocalRef("agent-alpha")
	work := s.claimAgentBackground(context.Background(), ref)
	if work == nil {
		t.Fatal("background was not admitted")
	}
	type result struct {
		release func()
		err     error
	}
	ready := make(chan result, 1)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go func() { release, err := s.yieldAgentBackground(ctx, ref); ready <- result{release, err} }()
	select {
	case <-work.ctx.Done():
	case <-ctx.Done():
		t.Fatal("background was not canceled")
	}
	select {
	case <-ready:
		t.Fatal("foreground admitted before actual resource release")
	default:
	}
	if next := s.claimAgentBackground(ctx, ref); next != nil {
		t.Fatal("background overtook waiting foreground")
	}
	s.releaseAgentBackground(ref, work)
	got := <-ready
	if got.err != nil {
		t.Fatal(got.err)
	}
	if next := s.claimAgentBackground(ctx, ref); next != nil {
		t.Fatal("background ignored foreground priority")
	}
	got.release()
	if next := s.claimAgentBackground(ctx, ref); next == nil {
		t.Fatal("released priority stranded background")
	} else {
		s.releaseAgentBackground(ref, next)
	}
}

func TestBackgroundPoliciesIndependentlyGateSimulationAndContact(t *testing.T) {
	for _, control := range []string{"life", "free_contact"} {
		for _, source := range []string{"life_planning", "life", "follow_up", "contact_judgment"} {
			t.Run(control+"/"+source, func(t *testing.T) {
				s := newRuntimeAgentServiceForPublicChatTest(t)
				ref := testRuntimeAgentLocalRef("agent-alpha")
				if err := s.mutateAgent(ref, func(e *agentEntry) ([]*runtimev1.AgentEvent, runtimeAgentStateTxHook, error) {
					e.Agent.Autonomy.Enabled = true
					e.Agent.Autonomy.Config.Mode = runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM
					e.Agent.Autonomy.Config.FreeContactEnabled = true
					return nil, nil, nil
				}); err != nil {
					t.Fatal(err)
				}
				work := s.claimAgentBackgroundFor(context.Background(), ref, source)
				if work == nil {
					t.Fatal("no background claim")
				}
				defer s.releaseAgentBackground(ref, work)
				entry, _ := s.agentByID(ref)
				identity, err := validateLocalAgentIdentity(entry.Agent.OwnerUserId, entry.Agent.RuntimeSourceRef, ref)
				if err != nil {
					t.Fatal(err)
				}
				intent := agentAutonomyMutationIntent{enabled: proto.Bool(false)}
				if control == "free_contact" {
					config := cloneAutonomyConfig(entry.Agent.Autonomy.Config)
					config.FreeContactEnabled = false
					intent = agentAutonomyMutationIntent{config: config}
				}
				if _, err := s.updateAgentAutonomyCAS(identity, entry.Agent.Autonomy.Revision, intent); err != nil {
					t.Fatal(err)
				}
				want := control == "life" && source == "life_planning" || control == "free_contact" && (source == "life" || source == "follow_up" || source == "contact_judgment")
				if (work.ctx.Err() != nil) != want {
					t.Fatalf("%s incorrectly canceled %s: %v", control, source, work.ctx.Err())
				}
			})
		}
	}
}
