# AI Configuration and Capability Scheduling in Nimi Home

In Nimi Home, users can manage local model recipes under "AI Capabilities", connect third-party providers under "Cloud Services", and assign execution routes for specific apps and agents.

## Ownership and Configuration Scopes

To ensure security isolation while enabling personalization, Nimi defines clean boundaries across AI configurations (AIConfig):

- **App-Owned AIConfig**: Each Nimi App maintains its own isolated AIConfig. Applications declare what capabilities they need (e.g., text generation, transcription), and users designate whether to route them locally or to the cloud.
- **LocalAgent Shared AIConfig**: All LocalAgents under the current user account share a unified base capability configuration, eliminating repetitive setup across different companions.
- **Chat Contexts**: Standard desktop chat uses the Desktop App configuration, while chatting with a specific Agent utilizes the shared LocalAgent configuration.

## Choosing Between Local and Cloud Execution

For every declared capability, users can choose their preferred route:

1. **Local**: Binds to the currently active machine default Loadout configured under AI Capabilities. Model inference runs entirely on local hardware, keeping data private and offline.
2. **Cloud**: Routes calls through a configured third-party connector (such as OpenAI, Anthropic, or compatible endpoints). For security, sensitive credentials and endpoints are managed securely within Runtime and are never exposed as plaintext in application-level configs.

## Importing and Applying AIProfiles

Users can import portable AIProfile templates to quickly configure recommended settings. Applying an AIProfile prefills the configuration form for review. Once local models are verified or cloud API keys are linked, saving confirms the configuration.

For instructions on acquiring local weights, see [Local AI in Nimi Home](/desktop/local-ai). For the runtime execution model, see [AI Profile Execution](/runtime/ai-profile-execution).

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
