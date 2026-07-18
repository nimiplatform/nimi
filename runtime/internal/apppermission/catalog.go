// Package apppermission owns Runtime's closed projection of the public Nimi
// App permission catalog. Product permission IDs are deliberately separate
// from Runtime-private operation and resource identities.
package apppermission

type Admission string

const (
	AdmissionReserved Admission = "reserved"
	AdmissionAdmitted Admission = "admitted"
)

type Descriptor struct {
	ID        string
	Admission Admission
}

var catalog = map[string]Descriptor{
	"agents.interact":       {ID: "agents.interact", Admission: AdmissionReserved},
	"artifacts.open":        {ID: "artifacts.open", Admission: AdmissionReserved},
	"account.profile.read":  {ID: "account.profile.read", Admission: AdmissionReserved},
	"memory.read":           {ID: "memory.read", Admission: AdmissionReserved},
	"memory.write":          {ID: "memory.write", Admission: AdmissionReserved},
	"knowledge.read":        {ID: "knowledge.read", Admission: AdmissionReserved},
	"knowledge.write":       {ID: "knowledge.write", Admission: AdmissionReserved},
	"notifications.send":    {ID: "notifications.send", Admission: AdmissionReserved},
	"notifications.receive": {ID: "notifications.receive", Admission: AdmissionReserved},
	"files.open":            {ID: "files.open", Admission: AdmissionReserved},
	"files.save":            {ID: "files.save", Admission: AdmissionReserved},
	"realm.library.read":    {ID: "realm.library.read", Admission: AdmissionReserved},
	"realm.library.manage":  {ID: "realm.library.manage", Admission: AdmissionReserved},
	"realm.publish":         {ID: "realm.publish", Admission: AdmissionReserved},
	"ai.background":         {ID: "ai.background", Admission: AdmissionReserved},
	"shared_resources.open": {ID: "shared_resources.open", Admission: AdmissionReserved},
}

// operationPermissions is Runtime-private enforcement wiring. Third-party
// apps see only the product permission id; operation and selector identities
// never become app-declared authority.
var operationPermissions = map[string]string{
	"artifacts.read_runtime_bytes":              "artifacts.open",
	"runtime_agent.conversation.open":           "agents.interact",
	"runtime_agent.conversation.turn_send":      "agents.interact",
	"runtime_agent.conversation.turn_subscribe": "agents.interact",
	"runtime_agent.conversation.snapshot":       "agents.interact",
	"runtime_agent.voice.transcribe":            "agents.interact",
	"runtime_agent.voice.stream_subscribe":      "agents.interact",
}

func Lookup(id string) (Descriptor, bool) {
	descriptor, ok := catalog[id]
	return descriptor, ok
}

func IsAdmitted(id string) bool {
	descriptor, ok := Lookup(id)
	return ok && descriptor.Admission == AdmissionAdmitted
}

func ForOperation(operationID string) (Descriptor, bool) {
	permissionID, ok := operationPermissions[operationID]
	if !ok {
		return Descriptor{}, false
	}
	return Lookup(permissionID)
}
