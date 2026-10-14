# AI Configuration and Capability Scheduling in Nimi Home

In Nimi Home, you configure local model loadouts under **AI Capabilities**, connect third-party providers under **Cloud Services**, and choose routes for each App and for your shared LocalAgent configuration.

## Ownership and Configuration Scopes

To balance security isolation with flexible setup, Nimi separates AI configurations (`AIConfig`) into clear scopes:

- **App-Owned AIConfig**: Each Nimi App maintains its own isolated `AIConfig`. An app declares the capabilities it needs—such as text generation or audio transcription—and you decide whether each capability runs locally or in the cloud.
- **LocalAgent Shared AIConfig**: All `LocalAgent` companions under your account share a baseline capability configuration, so you don't have to configure the same foundational models for every agent.
- **Chat Contexts**: Standard desktop chat uses the Desktop App configuration, while conversations with a specific Agent use the shared `LocalAgent` configuration.

## Choosing Between Local and Cloud Execution

For every declared capability, you can assign an execution route:

1. **Local**: Binds to your machine's active default `Loadout` under **AI Capabilities**. Inference runs entirely on your local hardware, processing that inference on-device. Online features and any Cloud capabilities retain their separate data flows.
2. **Cloud**: Routes requests through a configured third-party provider (such as OpenAI, Anthropic, or a compatible endpoint). Runtime stores API keys and endpoint URLs securely and never exposes them as plaintext in application-level configs.

## Importing and Applying AIProfiles

You can import portable `AIProfile` templates to apply recommended settings in a few clicks. Importing a profile pre-fills the configuration form so you can review each route. Once you verify that the required local models are ready or link the appropriate cloud API keys, save the form to apply your changes.

To download and manage local model weights, see [Local AI in Nimi Home](/desktop/local-ai). For details on how Runtime resolves and executes profiles, see [AI Profile Execution](/runtime/ai-profile-execution).

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
