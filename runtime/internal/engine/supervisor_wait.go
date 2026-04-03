package engine

import "time"

func waitSupervisorProcessExit(process *supervisedProcess, pid int, timeout time.Duration) bool {
	if timeout <= 0 {
		timeout = 100 * time.Millisecond
	}
	deadline := time.Now().Add(timeout)
	for {
		if process != nil {
			select {
			case <-process.done:
				return true
			default:
			}
		}
		if pid > 0 && !supervisorProcessAlive(pid) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(50 * time.Millisecond)
	}
}
