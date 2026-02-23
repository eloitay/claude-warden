---
description: Apply the YAML config change from the most recent warden block to allow the command
user_invocable: true
---

Look at the most recent warden block or flagged message in the conversation. It should contain a YAML snippet showing how to allow the blocked/flagged command.

Apply that YAML snippet to the appropriate warden config file:

- **Project-level** (recommended for project-specific commands): `.claude/warden.yaml`
- **User-level** (for commands you want to allow everywhere): `~/.claude/warden.yaml`

If the config file doesn't exist yet, create it with just the snippet content. If it already exists, merge the snippet into the existing config (append to `alwaysAllow` arrays, add/update entries in `rules`).

Ask the user which scope (project or user) they prefer if it's not obvious from context.
