# Credexis docs

The spec lives here and is enforced by CI + golden tests (post-mortem trap 10:
V1 died with three contradicting narratives). Docs change in the same PR as the
behavior they describe.

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the architecture blueprint (the spec).
- **[POSTMORTEM_V1.md](POSTMORTEM_V1.md)** — V1's forensic post-mortem (the traps
  V2 must never repeat).
- **[MASTER_TASK_LIST.md](MASTER_TASK_LIST.md)** — the milestone build order.
- **[environments.md](environments.md)** — environments & secret management.
- **[adr/](adr/)** — architecture decision records. Start from
  [ADR-0000-template.md](adr/ADR-0000-template.md); [ADR-0001](adr/ADR-0001-stack.md)
  records the stack; [ADR-0002](adr/ADR-0002-extractor-selection.md) records
  the extraction-vendor bake-off and selection.
- **[soc2/](soc2/)** — SOC 2 groundwork: access review, vendor register,
  change management.
- **[runbooks/](runbooks/)** — operational runbooks (incident response,
  restore drill).

The root **[CLAUDE.md](../CLAUDE.md)** carries the ten iron laws and the working
agreement; read it first.
