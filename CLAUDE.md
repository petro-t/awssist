# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AWSsist — a desktop AWS account & session manager (Electron + TypeScript + React).
Signs in to AWS SSO in-process via the OIDC device flow, manages profiles in
`~/.aws/config`, browses EC2/ECS/ECR/RDS/ElastiCache across accounts, and opens
SSM tunnels / shells in the user's native terminal.

## Commands

```sh
npm run dev              # hot-reload Electron + Vite dev run
npm run typecheck        # tsc strict checks (both configs below)
npm run typecheck:node   # main + preload (tsconfig.node.json)
npm run typecheck:web    # renderer (tsconfig.web.json)
npm run build            # production bundles into out/
```

There are no tests and no linter — `npm run typecheck` is the verification step.

Installers: `npm run dist:mac` / `dist:win` / `dist:linux` (electron-builder).
`dist:linux:full` (AppImage + .deb) must run on a Linux host. For a quick
unsigned local mac build use `npm run build:reinstall:mac`
(sets `CSC_IDENTITY_AUTO_DISCOVERY=false`; signing/notarization only happens
when the `CSC_*`/`APPLE_*` env vars are set — see README).

## Architecture

electron-vite three-process layout, configured in `electron.vite.config.ts`
(path aliases: `@shared`, `@main`, `@renderer`):

- `src/main/` — Electron main process (all Node and AWS SDK access lives here)
  - `ipc/` — one module per IPC namespace (`profiles`, `sso`, `ecs`, `ecr`,
    `resources`, `tunnels`, `exec`, `system`), each exporting a
    `register*Handlers()` called from `main/index.ts`
  - `aws/` — the `~/.aws` layer:
    - `config-file.ts` — ini read/write of `~/.aws/config` + `~/.aws/credentials`.
      These files are the source of truth; there is no internal profile DB —
      everything re-reads them on refresh.
    - `credentials.ts` — credential resolution with an in-memory cache
      (5-min renew margin); SSO profiles resolve via `GetRoleCredentials`,
      others fall back to `fromIni`.
    - `sso-device.ts` / `sso-cache.ts` — in-process OIDC device-authorization
      flow; tokens go to the standard `~/.aws/sso/cache` so aws CLI/boto3/etc.
      share the session.
    - `aliases.ts` — friendly display names in `~/.aws/awssist.json`.
    - `client.ts` — per-(profile, region) AWS SDK client factories.
- `src/preload/` — `contextBridge` exposing the typed `window.awssist` API
  (`AwssistApi`); `index.d.ts` declares it for the renderer.
- `src/renderer/` — React + Tailwind UI; Zustand store in `src/store.ts`,
  one file per tab in `pages/`.
- `src/shared/types.ts` — the IPC contract between main and renderer.

The renderer never touches Node or AWS APIs directly. Adding an IPC-backed
feature means touching four places: `shared/types.ts` → handler in
`main/ipc/<namespace>.ts` → `preload/index.ts` (+ `index.d.ts`) → renderer.

### Things that look odd but are load-bearing

- `main/index.ts` installs stdout/stderr `EPIPE`/`EIO` swallowers before any
  import that might log — Linux AppImages launched from a desktop file have no
  stdout and would otherwise crash on the first `console.log`.
- `main/index.ts` also augments `PATH` from the user's login shell at startup:
  GUI-launched Electron apps don't inherit the shell PATH, so `aws` /
  `session-manager-plugin` would be invisible otherwise.
- Tunnels spawn `aws ssm start-session` as a process group; Stop kills the
  whole group (parent `aws` + child `session-manager-plugin`) so the local
  port frees immediately.
- ECS/SSM shells run in the user's native terminal emulator (`ipc/exec.ts`),
  never in-app — there is deliberately no in-app PTY.

## Commit messages and PR descriptions

- **Do NOT add Co-Authored-By: Claude / Anthropic / any AI attribution lines.**
- **Do NOT add "🤖 Generated with Claude Code" or any "Generated with …" footer.**

Commits authored from this assistant should look like the user wrote them
manually. The Git author identity (`user.email`, `user.name` from
`git config`) is the only attribution.
