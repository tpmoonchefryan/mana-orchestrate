# Install Einzbern in a project

Load this reference only during an install-type task (install, restore, update, repair, rollback,
migrate, uninstall, or doctor); do not load it for any other work.

It is the wizard for a first installation, `setup --mode fresh`: one screen of questions, one final
confirmation, then the apply. Run the engine verbs below the way SKILL.md says to invoke the
engine. Supply two flags yourself: `--project <dir>`, the root of the project being set up (ask
only when it is unclear which project), and `--at <UTC>`, the current instant written
`YYYY-MM-DDTHH:MM:SSZ`. Where this device keeps the AGENTS.md Einzbern manages is a question of
its own, the project root below, and the user answers it.

## Installation layers

Core stores work, decisions and knowledge. Host Integrations connect native hooks and instruction files. Owner Extensions configure independent dot documents and optional schedules through [owner-extensions.md](owner-extensions.md).

## Traditional target workflow

The remaining sections describe the unchanged traditional target and its real host hooks.

## Use another reference when

- The user already has a library, from another device or a backup: `restore.md`.
- The plan reports an installation from before the rename: `migrate.md`.
- Einzbern already runs here and the user wants a newer engine, a repair, or a rollback:
  `update.md`.

## Before the plan: an engine on this device

The wizard installs from the engine that is current on this device. When
`<device directory>/engine/einzbern.mjs` does not exist, or a plan reports the blocker
`SETUP_ENGINE_NOT_INSTALLED`, put an engine there first with this skill's fetch step:
`node <skill directory>/scripts/install.mjs --archive <local archive>` installs a release archive
the user already has and fetches nothing, and `--version <version>` downloads that release. The
download is the only network use of the whole installation, so ask the user before it. The step
answers `INSTALL_ENGINE_READY`; then plan as below.

### Windows PowerShell

Use the installed Node executable and quote paths containing spaces. This example
installs a local release archive into an explicit device directory.

```powershell
node "<skill directory>\scripts\install.mjs" --archive "C:\Downloads\einzbern-<version>.tar.gz" --home "C:\Einzbern Device"
node "C:\Einzbern Device\engine\einzbern.mjs" commands
```

The archive's SHA-256 sidecar is required when `--sha256` is omitted. Windows
installation rejects reserved device names, alternate data streams, trailing
dots or spaces and case-colliding file names. Runtime directory forwarding uses
NTFS junctions. Stored bindings retain absolute paths for other drives and UNC
roots. Supply an explicit `--home` when testing an isolated install.

Windows host runners use the Windows PowerShell included with supported Windows versions and Job Objects to join
their descendant processes on completion or cancellation. PATH lookup accepts
native executables and `.cmd` or `.bat` shims. Kiro IDE discovery includes per-user
and Program Files installations. Runner recovery files receive private NTFS
permissions when created.

## Two separate checks: install succeeded vs. host ready

Report engine installation and host readiness as two distinct checks. Passing the engine smoke
check proves only that the release archive installed and launches; it does not prove a project is
registered, native host hooks executed, or Codex peer dispatch is admitted.

### Check 1: Install succeeded (read-only engine smoke)

Run a minimal read-only check that requires only Node.js and the installed launcher — no `jq`, no
registered project, and no host admission file.

POSIX shell (`sh` / `bash` / `zsh`):

```sh
EINZBERN_LAUNCHER="${EINZBERN_HOME:-$HOME/.einzbern}/engine/einzbern.mjs"
node "$EINZBERN_LAUNCHER" engine-list
node "$EINZBERN_LAUNCHER" commands
```

Windows PowerShell:

```powershell
$einzbernHome = if ($env:EINZBERN_HOME) { $env:EINZBERN_HOME } else { Join-Path $HOME ".einzbern" }
$launcher = Join-Path $einzbernHome "engine\einzbern.mjs"
node $launcher engine-list
node $launcher commands
```

Pass criteria: both commands exit `0`, `engine-list` returns `ENGINE_LIST_READY` with
`current.version` matching the installed release, and `commands` returns `CLI_CATALOG_READY`.

### Check 2: Host ready (project doctor and host-specific observation)

After `setup --mode fresh --yes true` (or `restore`) registers the project, verify host and
project configuration separately:

POSIX shell:

```sh
node "${EINZBERN_HOME:-$HOME/.einzbern}/engine/einzbern.mjs" doctor --project .
```

Windows PowerShell:

```powershell
$einzbernHome = if ($env:EINZBERN_HOME) { $env:EINZBERN_HOME } else { Join-Path $HOME ".einzbern" }
node (Join-Path $einzbernHome "engine\einzbern.mjs") doctor --project .
```

`doctor` checks local files and configuration (`hooks-present`, `skill-copies`, `registry`,
`managed-sections`, etc.). Discovering a host directory or writing its config files does **not**
certify that the host's native runtime loaded or fired a hook in a live session (for example,
Kiro and Antigravity config presence does not prove an IDE hook ran, and DSH plugin status is
reported read-only).

**Codex native observation (separate prerequisite and failure branch):**
Do not run `doctor --project . --codex-admission codex-admission.json` as an out-of-the-box
install smoke.
- **Prerequisite:** the project is registered, and `codex-admission.json` was freshly
  machine-assembled (within 5 minutes) from the owning Codex App Server's JSON-RPC `initialize` →
  `hooks/list` for `$PWD` together with SHA-256 hashes of the hook `sourcePath` and config
  (see `docs/codex-native-controller.md`).
- **Pass:** `doctor --project . --codex-admission codex-admission.json` returns `ok=true` and
  `hooks-present.detail.codexGuard.ready=true`.
- **Failure branch:** if `codex-admission.json` is unavailable, stale, disabled, untrusted, or
  mismatched, report **Codex host / peer dispatch not ready** while keeping Check 1 (install
  succeeded) separate. Do not report an engine install failure and do not treat passing local file
  reconciliation as Codex readiness; re-observe from the owning App Server before starting any
  dependent worker batch.

## Questions (one screen)

Ask the whole list at once, in one message. The list is the same on both hosts: Claude Code asks
it in one AskUserQuestion call, Codex asks it in the conversation as one numbered message. Ask
only the questions the plan reports as open, offer the plan's suggestion as the first choice,
never ask again for an answer the user already gave, and never guess an answer.

1. Library location. The shared library holds the projects' records under their stable project identities.
   The folder is named `Ether`; the user chooses its parent on any filesystem. The plan suggests
   the saved shared-library location, or `Ether` next to the device directory on a first install.
   `--artifacts` selects the complete library path. Subsequent projects reuse that location;
   cloud-provider detection does not constrain it.
   Flag: `--artifacts <library path>`.
2. Cloud drive. Is the library's folder synced by a cloud drive? The plan suggests an answer from
   the location. Flag: `--cloud true` or `--cloud false`.
3. Language. The language of the text Einzbern writes into the project's instruction files, as a
   language tag the plan lists among the question's choices, such as `en` or `zh-CN`.
   Flag: `--language <tag>`.
4. Navigation section. Add a short section that points agents to Einzbern in the project's
   instruction files? If not, the section is left out and the hooks point agents to Einzbern
   instead; the skill and the hooks are installed either way. Flag: `--navigation true` or
   `--navigation false`. The answer belongs to this device, not to the project, and each project
   registered here follows it only once it is repaired: when the answer changes, repair each
   other project `library-list` names with the same `--navigation` answer, as `update.md` says.
5. Project root. The folder that keeps the AGENTS.md Einzbern manages for this library on this
   device. The skill and the hooks live in the user's home; AGENTS.md is the only file that
   lives with a project, so the user says where it is. One library has one such folder on a
   device: another project of the same library is registered and recalled as usual and takes no
   managed sections of its own. The plan suggests the root this device already holds, else the
   project being set up when it is the library's first here. When the library already has other
   projects registered on a device that holds no root, the plan has no suggestion and reports
   `SETUP_ANSWER_REQUIRED`: the user must name it. An answer is the project being set up or a
   project root this device registered; to keep one AGENTS.md for a folder of several projects,
   set that folder up as the project (`--project`). Always ask this question on a first
   installation and never take the current directory for the answer.
   Flag: `--project-root <dir>`. The answer belongs to this device; it is changed later with
   `machine-settings-set --key agents.projectRoot --value <dir> --at <UTC>`.

## Model groups for the selected host

Use the setup plan's `modelPolicyOnboarding` guidance and
`engine-model-policy-catalog --host <actual-host>` to open that host's onboarding
draft. Offer main (main decision model group), economy (batch coordination model
group), and flagship. Flagship is optional; do not invent a model or effort for
any group. Preserve existing and custom categories and configured tiers.

For Codex's independent-conversation workflow, main and economy must each resolve
to a usable group before that mode is ready. Ask the user to choose actual models,
efforts and escalation policy together; a selected escalation ceiling also needs
a usable tier. Save through the existing governed `engine-model-policy-set`
entry (or its Atelier editor), with the actual actor and recorded Owner decision.
Catalog/onboarding drafts are not persisted model selections. If the user defers
configuration, state that Codex peer mode is not ready; ordinary installation and
other hosts remain available. Do not manufacture a decision or silently migrate
another host's groups. See `specs/engine-model-policy-v1.md`.

Codex uses two conversations by default. The device setting
`execution.codexDualConversation=false` selects single-conversation batching.
In dual-conversation mode, the non-coordinator polling setting
`execution.codexAllowNonCoordinatorPolling` defaults to false. Codex recovery is
documented in `docs/codex-native-controller.md`. Claude Code and DSH use one
conversation. Updates and repairs preserve user-edited hooks and groups.

When Kiro is selected by an existing global `${KIRO_HOME:-$HOME/.kiro}` or project `.kiro/`
configuration directory, fresh setup also manages Kiro's standalone Hooks file and Skill copy.
The CLI and IDE remain separate surfaces; CLI presence or an existing configuration directory
does not claim that an IDE Hook ran or that a CLI session selected V3. Other Kiro Hook files,
Agents, trust and permissions are preserved. This setup does not install the Kiro CLI or IDE
application.

When Antigravity is selected by `${ANTIGRAVITY_CONFIG_DIR}`, `.gemini/{config,antigravity-cli,antigravity-ide,antigravity}`
under `$HOME`, or a project `.agents/hooks.json` regular file, fresh setup also manages only the
top-level `"einzbern"` group in `${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/config}/hooks.json`, retires
any redundant unedited `"einzbern"` group from the current and registered workspace `.agents/hooks.json` files on the device, and installs
the global Skill copy under `${ANTIGRAVITY_CONFIG_DIR:-$HOME/.gemini/config}/skills/mana-orchestrate`.
Unrelated hook groups, skills, rules and plugins are preserved; setup does not install `agy`,
Antigravity IDE or Antigravity App.

When Devin is selected by its existing user configuration directory
(`${XDG_CONFIG_HOME:-$HOME/.config}/devin`, or `%APPDATA%\devin` on Windows), fresh setup also
manages only the Einzbern commands in the `hooks` key of its `config.json` and renders one subagent
profile per tier row of the device policy's `devin` host under `agents/`. Other keys, hooks and
profiles are preserved. A `config.json` that is not strict JSON is refused and left unchanged.
Devin reads the Skill copy under `~/.agents/skills`, so no further copy is installed. Setup does
not install Devin. See `specs/devin-host-v1.md`.

## Plan, final confirmation, apply

1. Plan. Run `setup --mode fresh --project <dir> --at <UTC>`, with a flag for each answer already
   known and without `--yes`. It writes nothing and returns `SETUP_PLAN_READY`: the decided
   answers, the open questions, the files it would write, the originals it would back up first,
   any warnings, and any blockers. A plan with blockers is refused on apply (`SETUP_BLOCKED`): show
   each blocker and resolve it before going on. A warning does not stop the apply:
   `HOST_WRITABLE_ROOTS_TRACKED_BY_GIT` names a project host file, `.claude/settings.local.json`
   or `.codex/config.toml`, that Git tracks and that the apply writes this device's library path
   into, because the library sits outside the project; committing that file would publish the path.
   When the user's home has DSH profiles, the plan also carries `dshPlugin`: for each profile,
   whether the `dsh-mana-orchestrate` plugin is installed, its version, and whether the launcher it
   would run is this device directory's (`hookPathMatches`). Show these facts; the wizard has no
   step that writes a DSH profile, so a missing plugin or another launcher is set up in DSH.
2. Ask the open questions on one screen, then plan again with the answers until none is open.
3. Final confirmation. Show the decided answers and every file the plan would write, as the plan
   lists them, then each entry of `warnings` with its file and message, and ask once whether to
   apply. Whether such a file stays tracked is the user's call: say so, and change nothing in Git.
   Continue only on a clear yes; a changed answer goes back to step 2.
4. Apply. Run the same command with `--yes true`. It returns `SETUP_APPLIED`: the files written,
   the backup directory, the same `warnings`, and `selfCheck`.
5. Knowledge store. A new library has none yet: until it has one, no card can be written to it,
   `knowledge-list` refuses with `KNOWLEDGE_PATH_INVALID`, and `recall` reports the project's
   store that way under `knowledgeStores`. Create it once with
   `knowledge-init --workspace <library path> --acknowledge-disposable true`, the library path
   being the one the plan decided; it answers `KNOWLEDGE_STORE_INITIALIZED`. A library that
   already has a store answers `KNOWLEDGE_ALREADY_EXISTS`, and that store stays as it is.
6. Report the files written, the backup directory, each warning again, and the self-check: the
   eight checks in `selfCheck.checks`, and what the hook added when it ran once with the project's
   name as the prompt (`selfCheck.injected`; nothing is added until the library holds something
   that matches). Handle any check that is not ok with `doctor.md`.

## Flags

| Answer | `setup` flag |
| --- | --- |
| Library location | `--artifacts <library path>` |
| Cloud drive | `--cloud true` or `--cloud false` |
| Language | `--language <tag>` |
| Navigation section | `--navigation true` or `--navigation false` |
| Project root of this device | `--project-root <dir>` |
| Yes at the final confirmation | `--yes true` |

Check the installation again at any time with `doctor --project <dir>`.

## Boundaries

The wizard never commits, pushes, edits `.gitignore`, or deletes anything, and neither do you
during this task. Whether a library inside the project is committed or ignored is the user's
call; say so if it comes up and change nothing.

## Codex peer dispatch readiness

Read the installed bundle's `docs/codex-native-controller.md` for the exact
scoped worker, durable role lifecycle and native-observation contracts. Independent
main/economy chats remain distinct from `collaboration.spawn_agent` workers.
Use the existing `--codex-admission` observation conduit for setup, doctor,
peer-record and worker prepare. Machine-assemble current public app-server
`hooks/list` raw output and hook/config byte observations; do not ask the Owner
to fill JSON. Native registration, enabled/current trust and role recovery must
be confirmed before a dependent worker batch. Unknown, missing, disabled or
untrusted state is not-ready even when file reconciliation passes. Old
`subagentStop` observations are legacy only and no such hook is installed.

Normal fresh/update/repair reports `codexGuard` in its self-check, preserves
user hooks/settings and durable `device:codex-peer-roles/`, and does not grant
trust. Re-observe after changes. Enrollment failures retain factual receipts
and return nonzero; recover only from validated retained evidence. Role retirement
or method change uses peer-record with the exact live Owner decision and actual
actor, followed by readback; terminal batches never retire roles implicitly.
Use owned isolated homes for validation. Source/fixture results and old prototypes
do not certify current native installation readiness.
