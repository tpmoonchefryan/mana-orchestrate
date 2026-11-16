---
name: mana-orchestrate
description: "The Grail grants wishes; Mana Orchestrate makes the mana flow to the right place at the right moment. It brings Einzbern, project memory, into Claude Code, Codex, Kiro, Antigravity and DeepSeek Harness: recall before you start, write results back to the work item, record decisions as minutes, keep lessons as cards. Where Einzbern is not installed yet, it is the wizard: install, restore, update, migrate, uninstall, health check. Use for Einzbern-managed coding, work items, knowledge cards, minutes, .ether, Atelier, installation or updates."
---

# Mana Orchestrate

Navigation for Einzbern 4.6.0: engine-generated; do not hand-edit.

Execution protocol: tcrn.host-execution-request.v1.

## Navigation

Root: nonempty abs `EINZBERN_HOME`, else `~/.einzbern`. `node "<root>/engine/einzbern.mjs" <verb>`; else install. `library-resolve --cwd <cwd>`: `libraryPath` for `--workspace`, work's `projectId` for `--project-id`. `commands`/`<verb> --help`: flags; UTC `--at`. Read engine bundle `specs/` beside `scripts/`, not this Skill.

Local writes queue together, not cross-device exclusion. Remote submission needs serial handoff. Dot installs no native hook, lifecycle manager or sync service.

| Moment | Verb | What to do |
| --- | --- | --- |
| Starting work | `recall`, `rule-list` | Use `recall --view agent --query "<task>" --at <UTC>`. Sessions read their live work. Enabled rules: `specs/work-practices-v1.md`; Kiro: `references/kiro-specs.md`; Dot blocker/privacy-publication: `specs/dot-rules-v1.md`. |
| Draft by work type | `work-draft` | Types/defects, inherited constraints, gaps: `specs/work-content-v1.md`. One native content, not a second acceptance copy. |
| Need the full text | `work-show`, `work-content-context`, `minutes-show`, `work-project-context`, `execution-prepare`, `execution-record`, `execution-evidence` | Read `work-show --id <id>` or `minutes-show --id <id>`. Use each target's `handoff` for dispatch/gates (`EINZBERN_PROJECT_CONTEXT`). Unresolved targets block dependent work. `--execution-request` requires `dispatchAdmitted=true` and the selected runner/model/effort. Keep that selection. Retain raw stdout/stderr/exit code. Evidence validation grants no execution permission. `specs/context-v1.md`, `specs/dispatch-admission-evidence-v1.md`. |
| Native dispatch (Codex, Claude, dot, Kiro CLI, Antigravity) | `execution-policy-resolve`, `execution-host-prepare`, `execution-host-record`, `execution-host-evidence`, `execution-codex-peer-record`, `execution-codex-peer-evidence`, `execution-antigravity-swarm-record`, `execution-antigravity-swarm-evidence` | Resolve policy and Class fallback/hard limits. Use normal prompt reports. Parent reads before dispatch, child reads before work. scope/permission, targets=[], machine-assembled raw returns/reports, attempt association (`--binding`/`--prior`), unknown/cancel/finality/review: `specs/host-fallback-v1.md`. Dot model selection is host-managed. Host Integrations/controller details: `docs/codex-native-controller.md`, `specs/kiro-host-v1.md`, `docs/antigravity-swarm-controller.md`. |
| Shared submission | `shared-submit-plan`, `shared-submit-evidence`, `shared-submit-advisory-read`, `shared-submit-advisory-write` | Complete baseline/engine changes; one complete pre-submit refresh + engine reapply; serial handoff; segments before manifest; verify remote bytes + complete destination replay; observe release. Advisory is not a lock; absence/age grants nothing. Query unknown publication before retry. `specs/shared-submit-v1.md`. |
| Work is done | `work-transition`, `work-annotate` | Actual actor/readback. Pending != complete. Compare original source, behavior and assertions; structure is not semantic acceptance. Dot/local consumption separately; unavailable remains unverified. `specs/batch-execution-v1.md`. |
| A decision is made | `minutes-record` | As soon as you judge, record D1–Dn; end with `已记 <minutes key> Dn` (English: `Recorded <minutes key> Dn`). `--supersedes`/`--withdraws`/`--coexists`. |
| A lesson is learned | `knowledge-create`, `knowledge-capture` | Capture at most five new sourced lessons; read back. Stable IDs, repository-relative evidence paths. No progress in AGENTS. |
| Configuration / UI | `settings-catalog`, `variable-list` | AGENTS: principles only. Scoped config, optional `design.authority`: `specs/configuration-contract-v1.md`. |

Coding tasks: read `specs/coding-style-v1.md`.

Versions: fixes/internal: patch; new features: minor; breaks: major. Explicit `--version`.

## Core commands

Add `--workspace <libraryPath>` and, for writes, `--at <UTC>`. `work-list --limit 20` gives summaries (`--full true` for content). `work-create --project-id <id> --kind Initiative --external-key <key> --title <title>`. `work-transition --id <id> --status active`. `work-annotate --id <id> --summary <text>`. `work-batch --from-file <json>`. `minutes-record --project-id <id> --external-key <key> --title <title> --summary <summary> --decisions-file <json>` takes a JSON string array. Check `verifiedReadback`/`localCommitted`. Verify remote delivery at destination.

## Three steps

1. Install this skill: `npx skills add tpmoonchefryan/mana-orchestrate`.
2. Say "install Einzbern". Hooks or independent dot target: `setup`; approval: install.md.
3. Installation, policy changes, restoration and publication need their own approvals. Owner Extensions (dot/schedules): `references/owner-extensions.md`.

## Install-type tasks

Install/restore/update/repair/rollback/migrate/uninstall/doctor: read `references/` (`install.md`, `restore.md`, `update.md`, `migrate.md`, `uninstall.md`, `doctor.md`); dot uses `owner-extensions.md`; never load them for any other work.
