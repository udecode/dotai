---
name: rca
description: Turn Remote Control on for every non-archived Claude Code session in the Claude desktop app.
disable-model-invocation: true
---

# Remote Control all

Run this from a Code session in the Claude desktop app. It needs the app's session tools, which a terminal or headless `claude -p` session does not have.

1. Load the tools with ToolSearch: `select:mcp__ccd_session_mgmt__list_sessions,mcp__ccd_session_mgmt__get_session,mcp__ccd_session_mgmt__set_remote_control`.
2. Call `list_sessions` with `limit: 200`, leaving archived sessions out. It never lists the session it runs in, so also call `get_session` with `session_id: "self"`.
3. For every session whose `remoteControlActive` is false, this one included, call `set_remote_control` with `enabled: true`. The step is done when every such session has answered `on`, `connecting` or a refusal.
4. Reply in one line: how many you turned on, how many were already on, and each session that refused with its reason. The app refuses a session that never ran a turn, one started from another device and an unattended one.
