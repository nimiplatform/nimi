package engine

import (
	"errors"
	"testing"
)

func TestEnsureManagedPythonRuntimeReusesVerifiedManagedInterpreter(t *testing.T) {
	installCalls := 0
	findCalls := 0
	path, version, err := ensureManagedPythonRuntimeWithCommands(
		func() (string, error) {
			findCalls++
			return `D:\shared-payload\environments\speech\_python-installations\cpython-3.12\python.exe`, nil
		},
		func(path string) (string, error) {
			if path == "" {
				t.Fatal("verification received an empty interpreter path")
			}
			return "Python 3.12.13\n", nil
		},
		func() error {
			installCalls++
			return nil
		},
	)
	if err != nil {
		t.Fatalf("reuse verified managed interpreter: %v", err)
	}
	if path == "" || version != "Python 3.12.13" || findCalls != 1 || installCalls != 0 {
		t.Fatalf("reuse result = (%q, %q, find=%d, install=%d)", path, version, findCalls, installCalls)
	}
}

func TestEnsureManagedPythonRuntimeInstallsOnlyWhenManagedFindIsMissing(t *testing.T) {
	findCalls := 0
	installCalls := 0
	path, version, err := ensureManagedPythonRuntimeWithCommands(
		func() (string, error) {
			findCalls++
			if findCalls == 1 {
				return "", errors.New("managed Python missing")
			}
			return `D:\managed\python.exe`, nil
		},
		func(string) (string, error) { return "Python 3.12.13", nil },
		func() error {
			installCalls++
			return nil
		},
	)
	if err != nil {
		t.Fatalf("install missing managed interpreter: %v", err)
	}
	if path == "" || version != "Python 3.12.13" || findCalls != 2 || installCalls != 1 {
		t.Fatalf("materialization result = (%q, %q, find=%d, install=%d)", path, version, findCalls, installCalls)
	}
}

func TestEnsureManagedPythonRuntimeDoesNotOverwriteUnverifiableExistingPayload(t *testing.T) {
	installCalls := 0
	_, _, err := ensureManagedPythonRuntimeWithCommands(
		func() (string, error) { return `D:\managed\python.exe`, nil },
		func(string) (string, error) { return "", errors.New("interpreter rejected") },
		func() error {
			installCalls++
			return nil
		},
	)
	if err == nil || installCalls != 0 {
		t.Fatalf("unverifiable existing payload must fail without install, err=%v install=%d", err, installCalls)
	}
}
