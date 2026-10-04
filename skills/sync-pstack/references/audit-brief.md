# Audit brief

The intent for sync-pstack's Audit mode, whether the lead judges the report or a `/pstack:interrogate` panel does. Fill the bracketed parts.

Judge every skill in [project] against pstack [tag], using the attached `audit.mjs` report. The owner wants to stay as close to pstack as the project's domain allows. A skill stays only when it holds knowledge pstack cannot have, or does a job pstack does not do.

For each skill, read its source (the `.agents/rules/<name>.mdc` file and its references, not the generated mirror) and the pstack skill or playbook closest to it, then give one verdict:

- **cut**: pstack, the block or another kept skill already does its job, or nothing uses it. Name what replaces it, every typed command or route that loses its target, and where each rule of its text lands. A waiver or gate label that names a retired tool is a policy question for the owner, not a rename.
- **fold**: its domain knowledge stays, but process text that pstack or the block owns goes. Quote each duplicated sentence beside the text that owns it, and say whether every copy agrees; a conflicting copy goes to the owner as a ruling before the fold is offered.
- **keep**: it holds domain knowledge pstack cannot have. Name that knowledge.

Treat the report's overlap lines as candidates, not verdicts: a sentence can repeat pstack on purpose, as a project override. A block rule the report lists with no marker is a finding: say whether it overrides pstack or only adds to it.

Check every typed count and route before calling a skill unused, because a playbook can load a skill nobody types. Never propose editing a skill installed from another repository; judge it keep or uninstall.

Record for each verdict which files were read in full and which were only searched; the plan counts its coverage from those rows. Judge each out-of-repo guide the project's `AGENTS.md` lists as a restatement of the block, like a skill that copies it. A proposed `/correct` run lists the mistakes that reached a commit apart from those an existing check caught, because a catch shows the enforcement already works.
