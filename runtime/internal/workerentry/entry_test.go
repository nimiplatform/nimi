package workerentry

import "testing"

func TestRunRejectsUnsupportedRole(t *testing.T) {
	err := Run("invalid-role")
	if err == nil {
		t.Fatal("should reject unsupported role")
	}
	expected := `unsupported worker role "invalid-role"`
	if err.Error() != expected {
		t.Fatalf("error message: got=%q want=%q", err.Error(), expected)
	}
}

func TestRunRejectsEmptyRole(t *testing.T) {
	err := Run("")
	if err == nil {
		t.Fatal("should reject empty role")
	}
}

func TestRunRejectsArbitraryStrings(t *testing.T) {
	for _, role := range []string{"admin", "root", "test", "AI", "Model"} {
		err := Run(role)
		if err == nil {
			t.Fatalf("should reject role %q", role)
		}
	}
}
