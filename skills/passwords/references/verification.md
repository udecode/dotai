# Complete unusual verification

Use this route for email or SMS challenges, passkey prompts, physical factors,
identity checks, or runtime-required confirmations. Keep the main skill's scope
and secret-handling rules throughout.

## Email or SMS

Use an already authorized, accessible mailbox or message connector. Match the
sender, service, account, and current login request before consuming a code or
link. Preserve unrelated messages. An accessible verification challenge alone
does not require the owner.

## Passkey alternatives

If a passkey prompt requires physical presence, inspect the official
**Try another way** path for an existing password or authenticator method.
The CLI cannot sign website passkeys. Use the browser extension when it can
complete the existing flow without human presence. Do not disable security
controls, create a new factor, or imitate biometric approval.

## Confirm a human requirement

itsme always requires the owner. Physical Touch ID, Face ID, security-key
presence, inaccessible challenges, identity checks, and runtime-required
confirmations also need [a focused handoff](handoff.md).

Never bypass CAPTCHAs or browser security warnings. Stop automated retries when
a credential is rejected or the service shows a security control. Inspect the
concrete failure before another attempt. For rejected or stale credentials,
read [credential recovery](credential-recovery.md).

After completing an available method, verify the authenticated page and correct
account through the UI. Do not treat opening or submitting a challenge as proof.
