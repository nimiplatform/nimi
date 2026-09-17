# Simulator build inputs

`selected-sources/*.yaml` contains the current workspace App roots selected by
the Simulator product. An empty directory means the Simulator selects no App;
fixtures live only in test roots and never become product rows.

Source URLs, revisions, trust, publication, admission, and permissions are not
Simulator build inputs. Each selected App owns its renderer and adapter contract
under its current workspace root.
