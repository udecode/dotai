---
name: design
description: Create or improve production UI composition, interactions and design standards using the current product and its actual component system.
metadata:
  source: udecode/dotai
  source-path: skills/design
---

# Design

Start with the user job, actor, intended decision and current rendered baseline. Read the product's design system, tokens, components and settled design decisions. Discover their actual owners; do not import another app's styles, library, folder paths or layout conventions.

Compose the complete operation: entry, meaningful hierarchy, primary action, data, pending/empty/error/success states and consequence. Preserve working behavior and access. Iterate the real owner; use `prototype` only when a throwaway experiment answers an unsettled design question.

- Make the subject and next action clear before adding decoration. Density should fit the user's comparison or action, not a fashionable card layout.
- Use existing primitives, typography, spacing and semantic color. A new primitive needs a missing behavior or composition that existing owners cannot express clearly.
- Controls must work or have an honest unavailable reason. Do not mix invented values into a real read, hide missing behavior behind a disabled showcase or expose implementation narration to users.
- Preserve keyboard, focus, labels, contrast and reduced-motion behavior. Match pending feedback and notifications to the actual consequence; success is not a substitute for saved-state read-back.
- Collection search/filter/pagination must operate over the intended dataset. Do not claim global filtering when only the current page is filtered.
- Keep edits contextual without obscuring the parent action under unnecessary overlay depth. Show errors where the user can recover.
- Write concise action/outcome copy. Delete redundant labels and explanation before adding more UI.

For normal UI work, inspect the actual route, significant states and narrow/mobile layout, then correct hierarchy, behavior and copy before closeout. `verify-app` records final proof; reuse it for `walkthrough` and the existing `atlas` inventory.

For an explicitly requested static design or design-first PRD, label static proof as static. Record the design's real file inventory, fixture/data contracts, accepted behavior and removal owner for every temporary fixture. Do not claim runtime or shipped status from a mockup. Later implementation honors settled design and removes fixtures; it does not reopen design without a changed requirement.

Design owns creation and standards; Task owns authorized implementation and delivery. No second lifecycle, mandatory variants or automatic deployment.
