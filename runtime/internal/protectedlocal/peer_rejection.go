package protectedlocal

import (
	"errors"
	"sync/atomic"
)

const (
	PeerRejectionTransportDesktop  = "desktop"
	PeerRejectionTransportLocalApp = "local_app"
)

// PeerRejection is the bounded fact a verified native listener reports when it
// refuses a connecting process before any protected transport exists. It
// carries no process identity, executable path, account, or authority
// material; Reason is set only when the refusal carried a typed failure.
type PeerRejection struct {
	Transport string
	Stage     string
	Reason    Reason
}

// PeerRejectionObserver receives listener refusals on the accepting goroutine
// and must return promptly.
type PeerRejectionObserver func(PeerRejection)

// peerRejectionSink hands listener refusals to the Runtime owner that records
// them. It is installed once that owner exists; refusals before then keep
// only the platform's native diagnostics.
type peerRejectionSink struct {
	observer atomic.Pointer[PeerRejectionObserver]
}

func (sink *peerRejectionSink) set(observer PeerRejectionObserver) {
	if sink == nil {
		return
	}
	if observer == nil {
		sink.observer.Store(nil)
		return
	}
	sink.observer.Store(&observer)
}

func (sink *peerRejectionSink) report(transport string, stage string, cause error) {
	if sink == nil {
		return
	}
	observer := sink.observer.Load()
	if observer == nil {
		return
	}
	rejection := PeerRejection{Transport: transport, Stage: stage}
	var failure *Failure
	if errors.As(cause, &failure) {
		rejection.Reason = failure.Reason()
	}
	(*observer)(rejection)
}
