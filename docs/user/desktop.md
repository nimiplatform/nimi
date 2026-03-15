# Desktop App Guide

The Nimi Desktop app is a native application built with Tauri that provides a graphical interface for AI interactions, mod management, and runtime configuration. It runs on macOS, Windows, and Linux.

## Download and Install

Download the latest release for your platform from the [Nimi releases page](https://github.com/nimiplatform/nimi/releases).

- **macOS**: updater archive (`.app.tar.gz`) for Apple Silicon and Intel
- **Windows**: NSIS installer (`.exe`)
- **Linux**: AppImage

On macOS, extract the archive to get the app bundle and move it to your Applications folder. On Windows, run the NSIS installer. On Linux, mark the AppImage as executable and launch it.

Automatic desktop updates resolve through [https://install.nimi.xyz/desktop/latest.json](https://install.nimi.xyz/desktop/latest.json).

## First Launch

When you open Nimi Desktop for the first time:

1. The app starts the Nimi runtime automatically if it is not already running
2. You are presented with the home screen
3. If no local model is installed, the app guides you through pulling one
4. You can optionally sign in to connect with the Nimi platform for social features and cloud sync

The app works fully offline for local AI generation. Signing in is optional and only needed for platform features like contacts, worlds, and profile.

## Main Interface

The desktop interface is organized around a sidebar and a main content area.

### Sidebar Navigation

The left sidebar provides access to all major sections:

- **Home** -- feed, posts, and social content from the Nimi platform
- **Contacts** -- friend list, friend requests, and contact details
- **Worlds** -- browse and interact with AI worlds and agents
- **Explore** -- discover new content, worlds, and users
- **Mod Hub** -- browse, install, and manage mods
- **Runtime Config** -- provider setup, model management, and runtime health
- **Settings** -- account, preferences, privacy, language, and advanced options

### Top Bar

The top bar shows the current section title and provides navigation controls. On some pages it includes tab switching and action buttons.

## AI Chat

### Starting a Conversation

Navigate to a world or agent to begin an AI conversation. The chat area displays message history as a timeline. Type your message in the input field at the bottom and press Enter to send.

### Switching Between Local and Cloud Models

AI routing is configured through the Runtime Config section. You can:

- Use local models for offline, private generation
- Switch to a cloud provider for access to larger models
- Configure which provider and model to use by default

The active model and provider are shown in the runtime configuration panel.

### Message Timeline

Conversations display as a message timeline with your messages and AI responses. The timeline supports scrolling through history and streaming responses in real time.

## Mod Hub

Mods extend Nimi with additional features, UI panels, and capabilities.

### Browsing Mods

Open the **Mod Hub** from the sidebar to see available mods. Each mod shows its name, description, and current status.

### Installing Mods

Select a mod from the hub and install it. The app downloads and registers the mod with the runtime.

### Managing Installed Mods

Open the **Mods** panel from the runtime configuration to see all installed mods. From here you can:

- Enable or disable individual mods
- View mod details and settings
- Remove mods you no longer need

Mods that provide UI extensions appear as additional panels or routes within the app.

## Runtime Config

The Runtime Config section is the control center for your local AI setup. It is organized into several pages:

### Overview

Shows a summary of runtime health, usage statistics, and active configuration.

### Local Engine

Configure the local AI engine. View engine status, adjust local model settings, and monitor resource usage.

### Cloud Providers

Add, edit, and remove cloud provider configurations. For each provider you can:

- Enter or update the API key
- Test connectivity
- Set a provider as the default for cloud routing

### Model Center

Browse the model catalog, view installed models, manage model dependencies, and download new models. The model center shows:

- **Installed models** -- models currently on your machine
- **Catalog** -- available models you can pull
- **Dependencies** -- required components for each model

### Mods

View and manage installed mods from within the runtime configuration.

### Runtime Health

Monitor the runtime process status, gRPC connectivity, and local engine health in real time.

## Settings

### Account

Manage your Nimi platform account, sign in or out, and view account details.

### Preferences

Customize appearance and behavior including theme, display density, and notification preferences.

### Language and Region

Set the app language and regional preferences.

### Privacy

Review and adjust privacy settings and data sharing preferences.

### Security

Manage security settings for your account.

### Data Management

Export, import, or clear local data.

### Advanced

Access developer mode, debug tools, and advanced runtime configuration options.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + ,` | Open Settings |
| `Cmd/Ctrl + Q` | Quit the app |
| `Cmd/Ctrl + R` | Refresh the current view |
| `Cmd/Ctrl + Shift + I` | Toggle developer tools (when developer mode is enabled) |
| `Enter` | Send message in chat |
| `Shift + Enter` | New line in chat input |
| `Escape` | Close modal or panel |

## Troubleshooting

### App Won't Launch

- Verify your OS meets the minimum requirements
- On macOS, check that the app is allowed in System Settings under Privacy and Security
- Try removing the app and reinstalling from a fresh download

### Blank Screen on Launch

- Restart the app
- Clear the app cache by deleting the Nimi Desktop data directory and relaunching
- Check for OS-level GPU or rendering issues, particularly on Linux with Wayland

### Runtime Not Connecting

- The desktop app starts the runtime automatically, but if it fails, start it manually from the terminal with `nimi start`
- Check `nimi status` from the terminal to verify the daemon is running
- Verify nothing else is using port 46371

### Mod Loading Errors

- Disable the problematic mod from Runtime Config and restart the app
- Check that the mod is compatible with your current Nimi version
- Reinstall the mod from the Mod Hub

### General Issues

- Check the runtime logs: `nimi logs --tail 100`
- Run `nimi doctor` from the terminal for a full diagnostic
- See the [Troubleshooting Guide](troubleshooting.md) for more solutions

## See Also

- [User Quickstart](index.md) -- get started with the CLI
- [CLI Command Reference](cli.md) -- command-line alternative to the desktop app
- [Troubleshooting](troubleshooting.md) -- expanded error reference
