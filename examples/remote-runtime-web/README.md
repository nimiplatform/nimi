# Remote Runtime website reference

A separate ecosystem website with real website passwords, verified per-user Nimi association, and direct browser-to-PC AI. It uses only the public TypeScript SDK. The website server is a narrow identity/signaling adapter; it has no AI proxy endpoint or Runtime credential.

The reference defaults to loopback and can bind an explicitly selected LAN address for cross-device acceptance. It is not an internet-ready account service: there is no email recovery, deployment automation or general identity product. Website passwords use salted scrypt; website users and associations persist in SQLite, while website and Nimi sessions remain in process memory. A server restart requires signing in again. Nimi context tokens never enter the browser. Logout/unlink report failed Realm revocation and allow an explicit retry without reopening the old local context.

For the complete source-package setup and first-call journey, see [Connect a Web App](../../docs/start/connect-web-app.md). The published SDK `0.22.2` artifact lacks this branch’s remote entrypoints; select the complete source archive.

## Prerequisites

- Node 24, pnpm and a complete SDK build containing remote Runtime access.
- The same Realm environment used by the signed-in primary PC.
- An actually admitted Registry `app` source with the exact App ID, client ID, origin and HTTPS callback. A candidate is not admission. Do not insert approval fixtures into the Registry or bypass its maintainer review for acceptance.
- A certificate trusted by the browser for the chosen website origin. TLS trust setup is an explicit operator action. Do not disable certificate verification or ignore browser security warnings.
- Home remote access enabled by the owner, then a single confirmation of this source. The reference does not perform either action.

`127.0.0.1` separates this website's cookies from the official development site on `localhost`; different ports alone would not provide cookie isolation. The server rejects matching website/login hostnames and requests for a different Host. For LAN acceptance, select two distinct hostnames or a hostname and an IP address that the client PC can resolve to the server, include them in the TLS certificate, and admit the exact new source. Keep the listener bound to the intended LAN interface; no router port forwarding is required for this LAN test.

## Run

Build the SDK from its package, then install the workspace and run this package's `check`, `test` and `build` scripts. Set these values in the process environment (none are AI provider credentials):

| Variable | Value |
| --- | --- |
| `REFERENCE_APP_ID` | Registry canonical App ID |
| `REFERENCE_CLIENT_ID` | Registry remote client ID |
| `REFERENCE_REALM_ENVIRONMENT` | Exact Realm environment identity |
| `REFERENCE_REALM_URL` | Realm API origin |
| `REFERENCE_NIMI_WEB_URL` | Official Nimi login site origin |
| `REFERENCE_TLS_KEY`, `REFERENCE_TLS_CERT` | Local PEM paths |
| `REFERENCE_DATA_DIR` | Optional website SQLite directory; defaults to `.data` |
| `REFERENCE_ORIGIN` | Optional exact HTTPS website origin; defaults to `https://127.0.0.1:4443` |
| `REFERENCE_BIND_HOST` | Optional explicit local IP address to listen on; defaults to `127.0.0.1` |

Run `pnpm start` from this package. The registered callback is `<REFERENCE_ORIGIN>/nimi/callback`. Create two actual website accounts in the UI to exercise user switching; no preset passwords or fake login results are provided.

## SDK delivery and acceptance

For isolated acceptance, replace the workspace SDK dependency with its public version and select a complete local `.tgz` through pnpm overrides, following the App Tools local package workflow. Reinstall after changing the archive; run ordinary `check`, `test` and `build`. Do not patch installed SDK files or treat a workspace build as evidence that the version is published.

Verify the registered website journey: own account → official Nimi login → Home source confirmation → direct connection → own AIConfig read/write → real Local/Cloud stream. The source declares `text.generate` and `text.annotate`. The text-annotation section uses the existing durable Job API with an App-generated submission ID; after a lost response, use `lookupSubmission` instead of replaying Submit. Local annotation preparation belongs to the PC manager, while the reference changes only its own App intent. Queries and explicit cancellation show the owner's actual state.

Check switching/unlink, explicit disconnect and unavailable direct networks. Website authentication tests only prove website identity and association persistence; they do not certify Realm, WebRTC, AI or Home acceptance. Record the actual source/build and network conditions used for acceptance; unrun product paths remain **NOT-VERIFIED**.
