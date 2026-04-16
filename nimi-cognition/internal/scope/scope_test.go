package scope

import "testing"

func TestValidate_Valid(t *testing.T) {
	cases := []string{
		"agent_001",
		"agent-abc",
		"a",
		"Agent_01JXYZ",
		"my-agent-with-dashes",
	}
	for _, c := range cases {
		if err := Validate(c); err != nil {
			t.Errorf("expected valid %q: %v", c, err)
		}
	}
}

func TestValidate_Invalid(t *testing.T) {
	cases := []struct {
		id     string
		reason string
	}{
		{"", "empty"},
		{"has spaces", "spaces"},
		{"has.dots", "dots"},
		{"has/slashes", "slashes"},
		{"has@special", "special chars"},
		{string(make([]byte, 129)), "too long"},
	}
	for _, c := range cases {
		if err := Validate(c.id); err == nil {
			t.Errorf("expected invalid for %s: %q", c.reason, c.id)
		}
	}
}

func TestMustValidate_Panics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic for invalid id")
		}
	}()
	MustValidate("")
}

func TestMustValidate_Returns(t *testing.T) {
	id := MustValidate("agent_001")
	if id != "agent_001" {
		t.Errorf("got %q", id)
	}
}
