# Plugins and packs

Plugins add new cards and tools. Packs group those cards so you can collect them and add them to your decks.

## Use an installed plugin

1. Open **Pack & Card Library**.
2. Find and open the plugin's pack.
3. Add the collected cards you want to your active deck.
4. Place a card from the bottom tray.
5. Connect it to the Agent or resource that should use it, then choose a supported relationship.

Installing, collecting, and placing are separate steps. An installed plugin does not automatically fill your tray.

## Choose a tool

Availability depends on your installed build and the plugin's requirements.

| Plugin | What you can do |
| --- | --- |
| Task Board | Track tasks and dependencies with connected Agents |
| Skill Toolboxes | Give Agents reusable skills and instructions |
| Agent Barracks | Prepare Agents with equipment and summon them when needed |
| Structure Viewer | View supported structure files opened in connected cards |
| MatCreator | Work with a materials research team and task workflow |
| SQLite | Keep a database card and grant scoped database operations |
| Codex | Use an alternative Agent runtime, when its requirements are installed |

## Add or remove plugins

The Store tab is currently a placeholder. OAW does not yet have an online plugin marketplace or a general one-click package installer. Follow the instructions from the plugin's author for your OAW build; plugins run trusted code, so choose packages you trust.

If a plugin includes a custom interface, installing its Python package alone may not be enough. Its author needs to provide instructions for a compatible application build.

Before disabling a plugin, remove its cards and other dependent objects from the world. The Library explains remaining dependencies. Disabling a plugin can make its collected cards unavailable; it does not erase your collection or deck references.

Want to create your own? Start with the separate [plugin developer guide](../developers/index.md).
