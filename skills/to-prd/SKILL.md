---
name: to-prd
description: Turn settled product scope into a buildable PRD with source-backed acceptance, dependency ownership and explicit proof and publication boundaries.
metadata:
  source: udecode/dotai
  source-path: skills/to-prd
---

# To PRD

Use the project's existing PRD owner/path; otherwise use `docs/prds/<name>.md`. Read current user intent, source evidence, vision, milestone and related PRDs. Use `grill-with-vision` for a consequential unresolved decision and `to-milestone` when the delivery ladder needs repair.

One PRD should deliver a coherent user or launch outcome across the required data, backend, UI and proof. Do not manufacture tiny schema/proof/helper PRDs or duplicate a recent same-family PRD. Expand the existing document or continue implementation when its settled scope already covers the work. Keep an explicit narrow request narrow.

Read [authoring](references/authoring.md) for the document contract. Classify readiness with evidence, not confidence percentages. Source claims distinguish proven facts, inferences, missing evidence and rejected claims.

If the request includes design work, use `design`. Record an accepted design's real inventory, data contracts and temporary fixture removal owners. A static plan is not a shipped UI or runtime pass. Implementation later wires settled UI instead of silently redesigning it.

Local authoring does not authorize publication. For requested external publication, resolve the existing destination document, publish the complete final body once and read back its body and required project/milestone metadata. A local file link is secondary context, not the external PRD body.

Finish with buildable scope or exact missing decisions, correct design/proof boundaries, refreshed milestone links and verified publication only when requested. A `prd` request stops here; a previously authorized `full` request continues through `task`.
