package engine

import "time"

const supervisorExitPollInterval = 50 * time.Millisecond

func waitSupervisorProcessExit(process *supervisedProcess, pid int, timeout time.Duration) bool {
	if process != nil {
		return waitSupervisorExitProbe(timeout, supervisorExitPollInterval, func() bool {
			select {
			case <-process.done:
				return true
			default:
				return false
			}
		})
	}
	return waitSupervisorExitProbe(timeout, supervisorExitPollInterval, func() bool {
		return pid > 0 && !supervisorProcessAlive(pid)
	})
}

// waitSupervisorExitProbe polls an injected exit observation until success or a
// strict deadline. Injection keeps slow-exit and timeout behavior unit-testable
// without creating or terminating an operating-system process.
func waitSupervisorExitProbe(timeout time.Duration, interval time.Duration, exited func() bool) bool {
	if timeout <= 0 {
		timeout = 100 * time.Millisecond
	}
	if interval <= 0 {
		interval = supervisorExitPollInterval
	}
	if exited == nil {
		return false
	}
	if exited() {
		return true
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-ticker.C:
			if exited() {
				return true
			}
		case <-timer.C:
			return exited()
		}
	}
}
