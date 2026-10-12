# Hand off only the remaining human action

Use this route after confirming that login needs the owner. Opening a login
screen does not establish a human blocker or resolve the task.

Prepare the exact service, account, profile, and verification screen. Focus that
window and tab before asking the owner to act. Focus the agent chat instead
when only a reply in chat is needed. State the required action without including
a password, code, recovery value, or secret link.

Preserve pending login and unfinished workflow tabs across turns using
`markHandoff()` or the runtime equivalent. Renew turn-scoped marks after resume
and before ending the turn. Check whether preservation succeeded. Report
unverified persistence instead of claiming a tab remains available.
Keep these tabs open until the workflow finishes or the owner asks to close
them. A cleanup request for completed pages excludes pending login tabs.

For several blocked sources, verify their current state and prepare the pending
screens together when the owner is ready. Respect a request to defer logins.
Continue independent authorized work when the task permits it. Keep the task's
run note current, and distinguish a confirmed human challenge from unverified
access or a tool failure.
