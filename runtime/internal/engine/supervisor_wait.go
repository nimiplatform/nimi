package engine

import "time"

func waitSupervisorProcessExit(process *supervisedProcess, pid int, timeout time.Duration) bool {
	if timeout <= 0 {
		timeout = 100 * time.Millisecond
	}
	if process != nil {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		select {
		case <-process.done:
			return true
		case <-timer.C:
			return false
		}
	}
	deadline := time.Now().Add(timeout)
	for {
		if pid > 0 && !supervisorProcessAlive(pid) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(50 * time.Millisecond)
	}
}
