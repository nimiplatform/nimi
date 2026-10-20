package runtimeagent

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// @nimi-authority: rule.nimi.runtime.agent-life.replacement
// Names identify retained unfinished work as well as refs. Formatting changes
// do not create a different activity; completed routines may occur again.
func lifeActivityName(title string) string {
	return cases.Fold().String(norm.NFKC.String(strings.Join(strings.Fields(title), "")))
}

func lifeActivityNameKey(title string) string {
	sum := sha256.Sum256([]byte(lifeActivityName(title)))
	return hex.EncodeToString(sum[:])
}

func (a *lifeActivity) nameKey() string {
	if a.RedactedNameKey != "" {
		return a.RedactedNameKey
	}
	return lifeActivityNameKey(a.Title)
}

func (l *agentLifeState) unfinishedNameConflict(title, exceptRef string) bool {
	key := lifeActivityNameKey(title)
	for ref, a := range l.Activities {
		if ref != exceptRef && a.Phase != lifeCompleted && a.Phase != lifeCanceled && a.nameKey() == key {
			return true
		}
	}
	return false
}

func (l *agentLifeState) validatePlanningActivity(p lifeFrameProposal, a *lifeActivity) error {

	if a == nil && l.unfinishedNameConflict(p.Title, "") {
		return fmt.Errorf("an unfinished activity with that name already exists; continue its existing reference")
	}
	return nil
}
