package runtimeagent

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"time"
	_ "time/tzdata"
)

func quietHoursActive(hours *runtimev1.AgentContactQuietHours, now time.Time) bool {
	if hours == nil {
		return false
	}
	loc, err := time.LoadLocation(hours.Timezone)
	if err != nil {
		return true
	}
	local := now.In(loc)
	minute := uint32(local.Hour()*60 + local.Minute())
	if hours.StartMinute < hours.EndMinute {
		return minute >= hours.StartMinute && minute < hours.EndMinute
	}
	return minute >= hours.StartMinute || minute < hours.EndMinute
}

func lifeContactAllowed(entry *agentEntry, now time.Time) bool {
	return entry != nil && !entry.Agent.GetAutonomy().GetBudgetExhausted() && lifeContactPermitted(entry, now)
}

func lifeContactPermitted(entry *agentEntry, now time.Time) bool {
	if entry == nil || entry.Agent == nil || entry.Life == nil {
		return false
	}
	config := entry.Agent.GetAutonomy().GetConfig()
	if entry.Life.ContactSinceUser {
		return false
	}

	if !config.GetFreeContactEnabled() || quietHoursActive(config.GetQuietHours(), now) {
		return false
	}
	cap := config.GetMaxFreeContactsPerDay()
	if cap == 0 {
		return false
	}
	count := uint32(0)
	for _, sent := range entry.Life.ContactTimes {
		if sent.After(now.Add(-24 * time.Hour)) {
			count++
		}
	}
	return count < cap
}
