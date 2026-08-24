package appregistry

import "testing"

func TestRegistryStoresOnlyCurrentRegisteredAppSubject(t *testing.T) {
	registry := New()
	capabilities := []string{"account.session.read", "runtime.agent.read"}
	if err := registry.UpsertInstance(
		"nimi.desktop",
		"nimi.desktop.local-first-party",
		"desktop-device",
		capabilities,
	); err != nil {
		t.Fatalf("UpsertInstance: %v", err)
	}
	capabilities[0] = "mutated"

	record, ok := registry.Get("nimi.desktop")
	if !ok || record.AppID != "nimi.desktop" || record.UpdatedAt.IsZero() {
		t.Fatalf("record = %+v, %t", record, ok)
	}
	instance := record.Instances["nimi.desktop.local-first-party"]
	if instance.AppInstanceID != "nimi.desktop.local-first-party" || instance.DeviceID != "desktop-device" || instance.RegisteredAt.IsZero() {
		t.Fatalf("instance = %+v", instance)
	}
	if len(instance.Capabilities) != 2 || instance.Capabilities[0] != "account.session.read" {
		t.Fatalf("capabilities = %v", instance.Capabilities)
	}

	instance.Capabilities[0] = "mutated-copy"
	record.Instances["nimi.desktop.local-first-party"] = instance
	stored, _ := registry.Get("nimi.desktop")
	if got := stored.Instances["nimi.desktop.local-first-party"].Capabilities[0]; got != "account.session.read" {
		t.Fatalf("Get leaked mutable registry state: %q", got)
	}
}

func TestRegistryTracksExactInstancesWithoutModeCeiling(t *testing.T) {
	registry := New()
	if err := registry.UpsertInstance("nimi.desktop", "instance-a", "device-a", []string{"account.session.read"}); err != nil {
		t.Fatal(err)
	}
	if err := registry.UpsertInstance("nimi.desktop", "instance-b", "device-b", []string{"runtime.agent.read"}); err != nil {
		t.Fatal(err)
	}
	if !registry.IsInstanceRegistered("nimi.desktop", "instance-a") ||
		!registry.IsInstanceRegistered("nimi.desktop", "instance-b") {
		t.Fatal("registered instances were not admitted")
	}
	if registry.IsInstanceRegistered("nimi.desktop", "instance-missing") ||
		registry.IsInstanceRegistered("nimi.other", "instance-a") {
		t.Fatal("unknown registered-App subject was admitted")
	}
	record, _ := registry.Get("nimi.desktop")
	if len(record.Instances) != 2 {
		t.Fatalf("instances = %+v", record.Instances)
	}
}

func TestRegistryRejectsEmptySubjectIdentity(t *testing.T) {
	registry := New()
	for _, input := range [][2]string{{"", "instance"}, {"app", ""}, {"   ", "instance"}} {
		if err := registry.UpsertInstance(input[0], input[1], "device", nil); err == nil {
			t.Fatalf("empty identity was accepted: %q/%q", input[0], input[1])
		}
	}
	if _, ok := registry.Get("   "); ok {
		t.Fatal("blank App lookup succeeded")
	}
}
