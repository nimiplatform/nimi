# Simulator build-control inputs

`selected-sources/*.yaml` contains zero or more exact
`nimi.simulator.selected-source/v1` descriptors owned by the Simulator.
`external-repositories.yaml` is the closed credential-free external repository
catalog. An empty directory and empty catalog mean the real Simulator product
selects no App; fixtures live only in test roots and never become product rows.

Source URLs, revisions, trust, publication, admission, and permissions must not
come from an App Manifest. A selected descriptor binds a full commit object,
source root/digest, App production entries, and Nimi host invocation entries.
