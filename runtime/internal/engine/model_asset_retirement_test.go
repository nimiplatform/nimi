package engine

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type retirementSubstrate struct {
	stops   int
	stopErr error
}

func (*retirementSubstrate) Ensure(context.Context, string, []string, func() error, localexecution.TextProgressFunc) (string, bool, error) {
	panic("not an inference test")
}
func (*retirementSubstrate) Healthy() bool { return true }
func (s *retirementSubstrate) Stop() error { s.stops++; return s.stopErr }

func TestModelAssetRetirementWaitsForHostLeaseAndConfirmedExit(t *testing.T) {
	substrate := &retirementSubstrate{stopErr: errors.New("process exit not confirmed")}
	host := newExecutionHostWithSubstrate(substrate, nil)
	host.residentModelAssets.capture([]capabilitydriver.InvocationExactBinding{{ModelAssetID: "model-a"}})
	<-host.lease
	if retired, err := host.RetireModelAsset("model-a"); retired || err != nil || substrate.stops != 0 {
		t.Fatal("busy Host was interrupted")
	}
	host.lease <- struct{}{}
	if retired, err := host.RetireModelAsset("model-b"); !retired || err != nil || substrate.stops != 0 {
		t.Fatal("unrelated model stopped this Host")
	}
	if retired, err := host.RetireModelAsset("model-a"); retired || err == nil {
		t.Fatal("failed stop was reported as exit")
	}
	substrate.stopErr = nil
	if retired, err := host.RetireModelAsset("model-a"); !retired || err != nil || substrate.stops != 2 {
		t.Fatalf("retry exit: retired=%v err=%v stops=%d", retired, err, substrate.stops)
	}
	if !host.residentModelAssets.uses("model-a") { // Host remains available for the next captured plan.
		select {
		case <-host.lease:
			host.lease <- struct{}{}
		default:
			t.Fatal("retirement consumed execution capacity")
		}
	} else {
		t.Fatal("retired process retained model facts")
	}
}

func TestResidentOutputDelaysRetirementWithoutOccupyingInference(t *testing.T) {
	for _, closeEarly := range []bool{false, true} {
		substrate := &retirementSubstrate{}
		host := newExecutionHostWithSubstrate(substrate, nil)
		host.residentModelAssets.capture([]capabilitydriver.InvocationExactBinding{{ModelAssetID: "model-a"}})
		body := host.residentModelAssets.holdOutput(io.NopCloser(strings.NewReader("audio")))
		select {
		case <-host.lease:
			host.lease <- struct{}{}
		default:
			t.Fatal("output transfer occupied inference capacity")
		}
		if retired, err := host.RetireModelAsset("model-a"); retired || err != nil || substrate.stops != 0 {
			t.Fatal("retirement interrupted output")
		}
		if !closeEarly {
			if _, err := io.ReadAll(body); err != nil {
				t.Fatal(err)
			}
		}
		if err := body.Close(); err != nil {
			t.Fatal(err)
		}
		if substrate.stops != 0 {
			t.Fatal("output cancellation stopped inference")
		}
		if retired, err := host.RetireModelAsset("model-a"); !retired || err != nil {
			t.Fatalf("output disposition did not release retirement: %v", err)
		}
	}
}
