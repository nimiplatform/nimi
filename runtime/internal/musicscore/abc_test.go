package musicscore

import "testing"

func TestABCStructureAndMelodyOnlyConditions(t *testing.T) {
	for _, score := range []string{"X:1\nM:4/4\nK:C\nC D E F|G2 z2|", "X:1\nV: Vocal name=\"Lead\"\nK:Eb\nV: Vocal\nz24z4\"Eb\"z4|\"Cm7\"C4E4G8|"} {
		if err := ValidateABC([]byte(score), false); err != nil {
			t.Fatal(err)
		}
	}
	for _, score := range []string{"not an ABC score", "X:1\nK:C\nhello world", "X:1\nK:C\n\"Am\"CDEF|", "X:1\nK:C\n[CEG]2|", "X:1\nI:abc-include private.abc\nK:C\nC|"} {
		if err := ValidateABC([]byte(score), true); err == nil {
			t.Fatalf("invalid melody score accepted: %q", score)
		}
	}
}
