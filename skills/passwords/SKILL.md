---
name: passwords
description: Set up unattended 1Password access on a Mac or sign in to websites and apps without repeated human approvals. Use for new-device setup, passwords, authenticator codes, email or SMS verification, passkey alternatives, and blocked logins.
---

# Sign in with 1Password

Use this method during already authorized tasks, within the owner's unattended
login permissions. Access does not authorize payments, purchases, account creation,
legal consent, credential changes, deletion, or broader vault grants. Keep each
task's separate approval requirements.

Keep passwords, tokens, TOTP seeds, current codes, recovery values, and secret
links in memory. Capture subprocess output and errors without printing them.
Keep secrets out of chat, tool output, files, shell history, process arguments,
clipboards, screenshots, and logs. Never reveal password fields for debugging.

## Routine login

1. Inspect the service through supported browser or native-app controls. Follow
   project browser rules. Verify the displayed account against the requested
   identity or provider registry. Preserve working sessions and browser profiles.
   Check relevant existing profiles before declaring the service signed out.
2. Read the current owner's machine configuration in
   `~/.config/agent-passwords/machines/`. Match its device and account before using
   its Keychain entry, vault IDs, and retrieval pattern. Keep local configuration
   outside the installed skill folder so updates preserve it.
3. Use the configured read-only service account first. Capture its token from
   the macOS login Keychain in the consuming process. Pass the token only through
   the `op` child-process environment for that operation, outside shell profiles.
   Find the item by service domain, provider, expected email, and portal name.
   Match the account and destination, then request only the needed fields.
   Send credentials directly from memory to the verified service's visible form
   through supported UI tools. The CLI `op` remains the underlying reader.
4. Submit the username and password. For an authenticator challenge, retrieve
   and enter a fresh code from the matching 1Password OTP field without exposing
   it. An OTP screen alone is not a human blocker. Use an ordinary remember-device
   option when authorized and permitted by the runtime.
5. Verify the resulting authenticated page and displayed account through the UI.
   Credential retrieval or a submitted form alone does not prove login succeeded.
   Report which layer passed and which remains untested. Keep proof free of secrets.

**itsme always requires the owner.** Keep payment signing and bank transaction
approval with the owner. Never bypass CAPTCHAs or browser security warnings.
If credentials are rejected or a security control appears, stop automated retries
and inspect the failure before another attempt.

## Load only the route needed

- For explicit new-Mac setup, provisioning, token rotation, revocation, or sharing
  this skill, read [new Mac setup](references/new-mac.md). A login request or
  missing token does not authorize provisioning or copying another Mac's token.
- If credential access fails, an item is outside granted vaults, an account is
  ambiguous, or a moved or changed item fails, read
  [credential recovery](references/credential-recovery.md) before asking the owner.
- For email or SMS verification, passkey prompts, physical factors, or other
  unusual challenges, read [verification alternatives](references/verification.md).
- When human action is confirmed necessary, read
  [the focused handoff](references/handoff.md) before asking the owner or ending
  the turn with a pending login.
