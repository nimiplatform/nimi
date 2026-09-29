// Package storedformat carries an owner's classification that Runtime-owned
// stored data in the selected data root is in a format or state this Runtime
// refuses to open. Owners produce it only from read-only checks; Runtime then
// serves its bounded maintenance surface and leaves that root unchanged.
package storedformat

import (
	"errors"
	"fmt"
	"strings"
)

// OfflineHandling names the developer-side offline step an owner requires.
// It is a closed diagnostic label, never an automatic Runtime action.
type OfflineHandling string

const (
	OfflineConversion OfflineHandling = "offline_conversion"
	OfflineRepair     OfflineHandling = "offline_repair"
)

// Refusal is one owner's refusal of the stored data it would open. It carries
// only the owner, the offline handling label, and the owner's bounded message;
// no stored content crosses this boundary.
type Refusal struct {
	owner    string
	handling OfflineHandling
	err      error
}

// Refuse builds an owner refusal. An empty owner or cause is a programming
// error and still yields a refusal so a classification is never lost.
func Refuse(owner string, handling OfflineHandling, cause error) *Refusal {
	if cause == nil {
		cause = errors.New("stored data refused")
	}
	return &Refusal{owner: strings.TrimSpace(owner), handling: handling, err: cause}
}

func (r *Refusal) Error() string {
	if r == nil {
		return "stored data refused"
	}
	return fmt.Sprintf("%s refused its stored data: %v", r.owner, r.err)
}

func (r *Refusal) Unwrap() error {
	if r == nil {
		return nil
	}
	return r.err
}

// Owner is the refusing owner's stable diagnostic name.
func (r *Refusal) Owner() string {
	if r == nil {
		return ""
	}
	return r.owner
}

// Handling is the offline step the owner requires.
func (r *Refusal) Handling() OfflineHandling {
	if r == nil {
		return ""
	}
	return r.handling
}

// As returns the refusal carried anywhere in err's chain.
func As(err error) (*Refusal, bool) {
	var refusal *Refusal
	if errors.As(err, &refusal) && refusal != nil {
		return refusal, true
	}
	return nil, false
}
