---
name: mana-orchestrate
description: "The Grail grants wishes; Mana Orchestrate makes the mana flow to the right place at the right moment. It brings Einzbern, project memory, into Claude Code, Codex, Kiro, Antigravity and DeepSeek Harness: recall before you start, write results back to the work item, record decisions as minutes, keep lessons as cards. Where Einzbern is not installed yet, it is the wizard: install, restore, update, migrate, uninstall, health check. Use for Einzbern-managed coding, work items, knowledge cards, minutes, .ether, Atelier, installation or updates."
---

# Mana Orchestrate

Navigation for Einzbern 4.5.1: engine-generated; do not hand-edit.

Execution protocol: tcrn.host-execution-request.v1.

## Navigation

Root: nonempty abs `EINZBERN_HOME`, else `~/.einzbern`. `node "<root>/engine/einzbern.mjs" <verb>`; install if absent. `library-resolve --cwd <cwd>`: `libraryPath` for `--workspace`, work's `projectId` for `--project-id`. `commands`/`<verb> --help`: flags; UTC `--at`. Read engine bundle `specs/` beside `scripts/`, not this Skill.

Local writes queue together, not cross-device exclusion. Remote submission needs serial handoff. Dot installs no native hook, lifecycle manager or sync service.

| Moment | Verb | What to do |
| --- | --- | --- |
| Starting work | `recall`, `rule-list` | Recall as needed: `recall --view agent --query "<task>" --at <UTC>`. Enabled rules only (`specs/work-practices-v1.md`). New, resumed and delegated sessions read their own live work. Specs: `references/kiro-specs.md`. Dot blocker/privacy-publication: `specs/dot-rules-v1.md`. |
| Draft by work type | `work-draft` | Types/defects, inherited constraints, gaps: `specs/work-content-v1.md`. One native content, not a second acceptance copy. |
| Need the full text | `work-show`, `work-content-context`, `minutes-show`, `work-project-context`, `execution-prepare`, `execution-record`, `execution-evidence` | Use each target's `handoff` for native dispatch/gates (`EINZBERN_PROJECT_CONTEXT`). Unresolved targets block only dependent work; coordination-only needs no development target. `specs/context-v1.md`. `--execution-request`: `dispatchAdmitted=true`; selected runner/model/effort, never substitute. Keep stdout/stderr/exit code; no reusable permit. `execution-evidence --from-file <json>` remains read-only validation, not authentication. `specs/dispatch-admission-evidence-v1.md`. |
| Native dispatch (Codex, Claude, dot, Kiro CLI, Antigravity) | `execution-policy-resolve`, `execution-host-prepare`, `execution-host-record`, `execution-host-evidence`, `execution-codex-peer-record`, `execution-codex-peer-evidence` | Resolve host/category/rejection policy; not permission. Class fallback/hard limits; normal prompt reports. Parent reads before dispatch, child reads before work. scope/permission, targets=[], machine-assembled raw returns/reports, attempt association (`--binding`/`--prior`), unknown/cancel/finality/review: `specs/host-fallback-v1.md`. Dot model selection is host-managed. Codex only: independent main/economy peers, no collector; `collaboration.spawn_agent`; workers native final; coordinator reports to manifest.main; reports threadId/hostId/prompt only; authorized settings/query exits: `docs/codex-native-controller.md`. Kiro: `specs/kiro-host-v1.md`; Antigravity: `specs/antigravity-host-v1.md`. Other hosts keep their workflow. |
| Shared submission | `shared-submit-plan`, `shared-submit-evidence`, `shared-submit-advisory-read`, `shared-submit-advisory-write` | Complete baseline/engine changes; one complete pre-submit refresh + engine reapply; serial handoff; segments before manifest; verify remote bytes + complete destination replay; observe release. Advisory is not a lock; absence/age grants nothing. Query unknown publication before retry. `specs/shared-submit-v1.md`. |
| Configuration backup or restore | `config-backup-plan`, `config-backup-create`, `config-backup-prepare`, `config-backup-commit`, `config-backup-verify`, `config-backup-list`, `config-backup-resume`, `config-backup-retire`, `config-restore-plan`, `config-restore-apply` | Allowlist; approved retention. Remote prepare/readback/commit; same-ID recovery, not authentication. Local unchanged. `specs/config-backup-v1.md`. |
| Work is done | `work-transition`, `work-annotate` | Actual actor/readback. Pending is not complete. Compare original source, behavior and assertions; structure is not semantic acceptance. Dot/local consumption separately; unavailable remains unverified. `specs/batch-execution-v1.md`. |
| A decision is made | `minutes-record` | As soon as you judge, record D1–Dn; end with `已记 <minutes key> Dn` (English: `Recorded <minutes key> Dn`). `--supersedes`/`--withdraws`/`--coexists`. |
| A lesson is learned | `knowledge-create`, `knowledge-capture` | Capture at most five new sourced lessons; read back. Stable IDs, repository-relative evidence paths. No progress in AGENTS. |
| Configuration / UI | `settings-catalog`, `variable-list` | AGENTS: principles only. Read scoped config and optional `design.authority`: `specs/configuration-contract-v1.md`. |

Coding tasks: read `specs/coding-style-v1.md`.

Versions: compatible fixes/internal changes: patch; new public features: minor; public breaks: major. Explicit `--version`.

## Three steps

1. Install this skill: `npx skills add tpmoonchefryan/mana-orchestrate`.
2. Say "install Einzbern". Traditional hooks or independent dot target: `setup`; approval: install.md.
3. Installation, policy changes, restoration and publication retain their separate approvals. 20-minute patrol and daily 00:00 Asia/Shanghai backup are independent; unapproved policy forbids daily enablement; unknown stays unknown.

## Install-type tasks

Install/restore/update/repair/rollback/migrate/uninstall/doctor: read `references/` (`install.md`, `restore.md`, `update.md`, `migrate.md`, `uninstall.md`, `doctor.md`); dot: install; never load them for any other work.
