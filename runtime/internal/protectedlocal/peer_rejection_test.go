package protectedlocal

import (
	"errors"
	"fmt"
	"testing"
)

func TestPeerRejectionSinkReportsOnlyBoundedFacts(t *testing.T) {
	var sink peerRejectionSink
	sink.report(PeerRejectionTransportDesktop, "before-observer", errors.New("dropped"))

	var got []PeerRejection
	sink.set(func(rejection PeerRejection) { got = append(got, rejection) })
	sink.report(PeerRejectionTransportDesktop, "desktop-process",
		fmt.Errorf("verify peer: %w", fail(ReasonDesktopExecutableTrustFailed, false, "reinstall_desktop", errors.New("/Applications/Evil.app signature mismatch"))))
	sink.report(PeerRejectionTransportLocalApp, "launch-lease", errors.New("pid 4242 has no launch lease"))

	want := []PeerRejection{
		{Transport: PeerRejectionTransportDesktop, Stage: "desktop-process", Reason: ReasonDesktopExecutableTrustFailed},
		{Transport: PeerRejectionTransportLocalApp, Stage: "launch-lease"},
	}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("reported rejections = %+v, want %+v", got, want)
	}

	sink.set(nil)
	sink.report(PeerRejectionTransportDesktop, "after-reset", nil)
	if len(got) != len(want) {
		t.Fatalf("cleared observer still received %+v", got)
	}
}
