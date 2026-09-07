# Web And Nimi Home

The Nimi website and Nimi Home serve different tasks. The public website introduces the product, provides download and policy information, and handles account authentication and account-security interactions backed by Realm. Nimi Home is the installed product entry, currently hosted by Desktop.

## What Happens In The Browser

Use the public Web surface for product and App information, account sign-in and security, legal pages, download status, and navigation. Web App pages are informational; they do not provide a browser-hosted Nimi Home or establish App installation, Registry admission, or Runtime access.

Realm remains the account and ecosystem identity owner. Web presents the account interaction; Desktop uses the admitted browser handoff rather than embedding credential forms or assembling a separate login path.

## What Happens In Nimi Home

Run local App development through the Desktop-supervised host and use the App's public SDK/Kit binding. Runtime owns capability execution and access decisions. The public site does not host the Desktop renderer or a Desktop Web adapter.

For third-party App code, consume the public SDK and Kit. Do not import Desktop renderer internals or use the public website as a shortcut around Runtime authorization.

## Reader Scenario: Finish Sign-in, Then Continue In The App

A user may complete an account interaction in the browser and return to Nimi Home. The browser interaction does not itself prove that a particular App is installed, running, or allowed to call an AI capability. The App must use the current host session and handle the real access or execution result.

To start developing an App, follow [Create a Nimi App](/start/create-an-app). For available product builds, check [Download](https://nimi.ai/download).

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/web/src/site-router.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/web/src/site-router.tsx)
