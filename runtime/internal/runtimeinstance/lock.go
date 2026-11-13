package runtimeinstance

import "errors"

var ErrAlreadyRunning = errors.New("a Nimi Runtime is already running on this machine; quit it before starting another installed or source Runtime")

// @nimi-authority: rule.nimi.platform.core-protocol.development-topology
// AcquireLock holds one machine-wide lease until Runtime exits. The lease is
// independent of account, Realm, build type, data directory and environment.
// It is concurrency control, not a Runtime authentication mechanism.
func AcquireLock() (func() error, error) {
	return acquireLock("nimi-runtime")
}
