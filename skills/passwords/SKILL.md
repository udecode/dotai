---
name: passwords
description: Set up unattended 1Password access on a Mac or sign in to websites and apps without repeated human approvals. Use for new-device setup, passwords, authenticator codes, email or SMS verification, passkey alternatives, and blocked logins.
---

# Sign in with 1Password

Use this method for authentication during already authorized tasks. The owner
authorizes unattended login and accepts the reduced security of agent-readable
credentials. This permission covers access, not payments, purchases, account
creation, legal consent, credential changes, deletion, or broader vault grants.
Keep each task's separate approval requirements.

## Set up a new Mac or share this skill

For an explicit setup request, read [the new Mac guide](references/new-mac.md).
It covers installation, the owner's access choices, a separate service account,
Keychain storage, recovery, and verification. A routine login request does not
authorize provisioning. A new owner must establish their own approval preferences.

For sharing, include this file and `references/new-mac.md`. Exclude local machine
configurations and recovery records. The recipient provisions their own token.

## Reuse the correct session

1. Inspect the requested service in the browser or native app. Use the active
   runtime's supported UI controls. Follow project rules for the browser choice.
2. Verify the service's displayed account against the requested identity or
   provider registry. Preserve working sessions and existing browser profiles.
   Do not log out another account just to test credentials.
3. When several profiles exist, check the service in the relevant existing
   profiles before declaring it signed out. A paused browser sync badge or an
   inaccessible profile does not establish the service's authentication state.

## Retrieve existing credentials unattended

Use the configured read-only service account first. Load its token from the
macOS login Keychain into the consuming process. Pass it through a child-process
environment for that operation. Do not use personal `op signin` for routine
service-account reads, or export the token in a shell profile.

Look in `~/.config/agent-passwords/machines/` for the current owner's machine
configuration. Keep these local records outside the installed skill folder so
skill updates preserve them. Match the configuration's
device and account before using its Keychain entry, vault IDs, and retrieval
pattern. A portable copy has no machine configuration until setup is complete.
A missing token is an access blocker, not permission to create a service account
or copy another Mac's token.

Find the item by service domain, provider, expected email, and portal name.
Match the account and destination before reading credentials. Request only the
needed fields. Keep secret values in memory inside the consuming process and
send them directly to the verified service's visible form through supported UI
tools. The CLI `op` remains the underlying reader, not a separate login workflow.

Keep passwords, service tokens, TOTP seeds, current codes, recovery codes, and
secret login links out of chat, tool output, files, shell history, process
arguments, screenshots, and logs. Capture command output instead of returning
it. Catch subprocess errors before a tool can print their captured output.
Never display a password field to debug authentication.

If the item exists only outside the granted vaults, use the personal fallback
below. Reading credentials does not authorize moving items or changing sharing.

## Complete the service's verification

1. Fill the existing username and password, then submit the login form.
2. For an authenticator challenge, retrieve a fresh code from the matching
   1Password OTP field and enter it without exposing the value. An OTP or 2FA
   screen alone is not a human blocker.
3. For an email or SMS challenge, use an already authorized, accessible mailbox
   or message connector. Match the sender, service, account, and current login
   request before consuming a code or link. Preserve unrelated messages.
4. If a passkey prompt requires physical presence, inspect the official
   **Try another way** path for an existing password or authenticator method.
   The CLI cannot sign website passkeys. Use the browser extension when it can
   complete the existing flow without human presence. Do not disable security
   controls, create a new factor, or imitate biometric approval.
5. Use an ordinary option to remember the existing device when offered and
   permitted by the runtime. Do not extend permissions beyond routine sign-in.
6. Verify the resulting authenticated page and displayed account. A successful
   credential read or submitted form is not proof of a successful website login.

**itsme always requires the owner.** Physical Touch ID, Face ID, security-key
presence, inaccessible challenges, identity checks, and runtime-required
confirmations also need a focused handoff. Keep payment signing and bank
transaction approval with the owner. Never bypass CAPTCHAs or browser security
warnings. Stop automated retries when a credential is rejected or the service
shows a security control. Inspect the concrete failure before another attempt.

## Recover credential access

For personal access or authorized provisioning, use one persistent shell or PTY
for the whole task. Run `op signin` once if necessary and reuse that exact
session for subsequent operations. Keep the service token out of the personal
session's environment.

If the CLI cannot reach the 1Password desktop app, open the app through supported
native controls and retry in the same session. Ask the owner only when access
remains locked or unavailable, no plausible item exists, the account remains
ambiguous, or human presence is technically required. Report the specific
blocker and attempted recovery without exposing command output containing secrets.

Use the current canonical item after a move or rotation. Consult recorded ID
mappings when a reference is stale. If an authorized automation copy exists,
refresh it from its source after a credential change before retrying. Prefer
authorized moves over permanent copies, but preserve human sharing and the
project's migration scope. Service accounts cannot read the built-in Private vault.

## Hand off only the remaining human action

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
access or a tool failure. Opening a login screen does not resolve the task.

## Prove the result

For credential setup, verify service-account identity and a real authorized item
read from a fresh process. For login work, verify the authenticated service and
correct account through the UI. Report which layer passed and which remains
untested. Keep proof artifacts free of credentials.
