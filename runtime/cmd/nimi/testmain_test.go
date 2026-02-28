package main

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	tempHome, err := os.MkdirTemp("", "nimi-cmd-home-*")
	if err != nil {
		panic(err)
	}

	homeValue, homeSet := os.LookupEnv("HOME")
	configValue, configSet := os.LookupEnv("NIMI_RUNTIME_CONFIG_PATH")

	if err := os.Setenv("HOME", tempHome); err != nil {
		panic(err)
	}
	if err := os.Unsetenv("NIMI_RUNTIME_CONFIG_PATH"); err != nil {
		panic(err)
	}

	exitCode := m.Run()

	if homeSet {
		_ = os.Setenv("HOME", homeValue)
	} else {
		_ = os.Unsetenv("HOME")
	}
	if configSet {
		_ = os.Setenv("NIMI_RUNTIME_CONFIG_PATH", configValue)
	} else {
		_ = os.Unsetenv("NIMI_RUNTIME_CONFIG_PATH")
	}
	_ = os.RemoveAll(tempHome)

	os.Exit(exitCode)
}
