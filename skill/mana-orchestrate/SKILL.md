---
name: mana-orchestrate
description: "The Grail grants wishes; Mana Orchestrate makes the mana flow to the right place at the right moment. It brings Einzbern, project memory, into Claude Code, Codex, Kiro, Antigravity and DeepSeek Harness: recall before you start, write results back to the work item, record decisions as minutes, keep lessons as cards. Where Einzbern is not installed yet, it is the wizard: install, restore, update, migrate, uninstall, health check. Use for Einzbern-managed coding, work items, knowledge cards, minutes, .ether, Atelier, installation or updates."
---

# Mana Orchestrate

Navigation for Einzbern 5.0.1: engine-generated; do not hand-edit.

Execution protocol: tcrn.host-execution-request.v1.

## Navigation

Root: nonempty absolute `EINZBERN_HOME`, else `~/.einzbern`. commands/<verb> --help: flags; --at UTC. Read engine bundle `specs/` beside `scripts/`, not this Skill.

Local writes queue together, not cross-device exclusion. Remote submission: serial handoff. Dot installs no native hook, lifecycle manager or sync service.

| Moment | Verb | What to do |
| --- | --- | --- |
| Starting work | `recall`, `rule-list` | Use `recall --view agent --query "<task>" --at <UTC>`. Sessions read their live work. Enabled rules: `specs/work-practices-v1.md`; Kiro: `references/kiro-specs.md`; Dot blocker/privacy-publication: `specs/dot-rules-v1.md`. |
| Draft by type | `work-draft` | Types/defects, inherited constraints, stages: specs/work-content-v1.md. One record, not a second acceptance copy. |
| Full text | `work-show`, `work-content-context`, `minutes-show`, `work-project-context`, `execution-prepare`, `execution-record`, `execution-evidence` | Read `work-show --id <id>` or `minutes-show --id <id>`. Use each target's `handoff` for dispatch/gates (`EINZBERN_PROJECT_CONTEXT`). Unresolved targets block dependent work. `--execution-request` requires `dispatchAdmitted=true` and selected runner/model/effort. Keep that selection. Validate with `execution-evidence --from-file <json>`. Retain raw stdout/stderr/exit code. Evidence validation grants no execution permission. `specs/context-v1.md`, `specs/dispatch-admission-evidence-v1.md`. |
| Native dispatch (Codex, Claude, dot, Kiro CLI, Antigravity) | `execution-policy-resolve`, `execution-host-prepare`, `execution-host-record`, `execution-host-evidence`, `execution-codex-peer-record`, `execution-codex-peer-evidence`, `execution-antigravity-swarm-record`, `execution-antigravity-swarm-evidence` | Resolve policy; Class fallback, hard limits. Use normal prompt reports. Parent reads before dispatch, child reads before work. scope/permission, targets=[], machine-assembled raw returns/reports. Dot model selection is host-managed. Host Integrations/controller details: specs/kiro-host-v1.md, docs/antigravity-swarm-controller.md. attempt association and failure outcomes: --binding/--prior; unknown/cancel/finality/review: specs/host-fallback-v1.md. |
| Shared submit | `shared-submit-plan`, `shared-submit-evidence`, `shared-submit-advisory-read`, `shared-submit-advisory-write` | Complete baseline/engine changes; one complete pre-submit refresh + engine reapply; serial handoff; segments before manifest; verify remote bytes + complete destination replay; observe release. Advisory is not a lock; absence/age grants nothing. Query unknown publication before retry. `specs/shared-submit-v1.md`. |
| Done | `work-transition`, `work-annotate` | Actual actor/readback. Pending != complete. Compare original source, behavior and assertions; structure is not semantic acceptance. Dot/local consumption separately; unavailable remains unverified. specs/batch-execution-v1.md. |
| Decision | `minutes-record` | As soon as you judge, record D1–Dn; end with `已记 <minutes key> Dn` (`Recorded <minutes key> Dn`); --supersedes/--withdraws/--coexists. |
| Lesson | `knowledge-create`, `knowledge-capture` | Capture at most five new sourced lessons; read back. Stable IDs, repository-relative evidence paths. No progress in AGENTS. |
| Config / UI | `settings-catalog`, `variable-list` | AGENTS: principles only. Scoped config; optional `design.authority`: specs/configuration-contract-v1.md. |

Coding: `specs/coding-style-v1.md`.

Version: patch fixes, minor adds, major breaks; --version.

## Core commands

work-list summarizes; --full true shows content. work-create/work-transition/work-annotate/work-batch write. `minutes-record --decisions-file <json>` takes a JSON string array; verify verifiedReadback/localCommitted/remote delivery.

Codex: owning App Server JSON-RPC `initialize` → `hooks/list` for `$PWD`; fresh project-bound `--codex-admission` from raw result; SHA-256 hook `sourcePath`/config hashes. docs/codex-native-controller.md. Reobserve within five minutes; require `ok=true` and `hooks-present.detail.codexGuard.ready`.

```sh
e() { node "${EINZBERN_HOME:-$HOME/.einzbern}/engine/einzbern.mjs" "$@"; }
w="$(e library-resolve --cwd "$PWD" | jq -r .libraryPath)"
p="$(e rule-list --project . | jq -r .projectId)"
e doctor --project . --codex-admission codex-admission.json
e rule-list --workspace="$w" --project-id="$p"
e work-show --workspace="$w" --external-key TCRN-CROSS-STORY-692
printf '%s' '["已核验 1,392 个文件"]' > decisions.json
e minutes-record --workspace="$w" --project-id="$p" --title check --summary done --decisions-file decisions.json --actor agent:codex --external-key m$(date +%s) --at "$(date -u +%FT%TZ)"
```

## Three steps

1. `npx skills add tpmoonchefryan/mana-orchestrate`.
2. Say "install Einzbern"; setup hooks or independent dot target (install.md).
3. Installation, policy changes, restoration and publication need their own approvals. Dot/schedules: references/owner-extensions.md.

## Install-type tasks

Install/restore/update/repair/rollback/migrate/uninstall/doctor: `references/` (`install.md`, `restore.md`, `update.md`, `migrate.md`, `uninstall.md`, `doctor.md`); Dot: `owner-extensions.md`; never load them for any other work.
