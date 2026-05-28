# AWSsist Release Notes

## v0.2.0 — EC2, cross-platform installers, themes · 2026-05-26

The second drop. v0.1.0 was the first end-to-end build; v0.2.0 broadens the
surface area (new tab, new platforms, new theme) and replaces the SSO sign-in
flow with one that actually keeps you signed in for the long haul.

### New features

- **EC2 tab** — list every running / stopped instance in the active
  profile + region with name, id, type, state, AZ, private + public IPs.
  Live search across all of those fields and tag values. Per-row **SSM**
  button opens `aws ssm start-session` in your native terminal.
- **Windows + Linux installers** built from the same macOS host. Ships
  Windows NSIS installers (x64 + arm64), a Windows portable .exe, and Linux
  AppImage (x64 + arm64). `.deb` is left to Linux hosts because of a known
  fpm bug on Apple Silicon.
- **Dark / Light / System theme** with full token-based theming — every
  surface honours the active theme; toggle in the sidebar footer or
  Settings → Appearance. Follows macOS appearance when set to "System".
- **App icon and brand artwork.** Shield mark for the Dock / Applications /
  Finder; matching dark + light wordmark logos.
- **Sign Out action** on SSO sessions — deletes the cached SSO token
  (same as `aws sso logout`) and flushes the in-memory credential cache for
  every profile that uses that session.
- **Bastion + port modal** for tunnels — proper dialog with bastion picker
  (radio list when more than one) and a real local-port input. Replaces the
  silent-no-op `window.prompt()` flow.
- **Per-instance SSM into EC2** — the same one-click terminal experience
  ECS exec already had, now for arbitrary EC2 hosts.

### Auth & sessions

- **Switched SSO sign-in from device flow to `authorization_code` + PKCE.**
  Device flow refresh tokens were short-lived and often non-renewable; PKCE
  registers the OIDC client with `grantTypes=['authorization_code', 'refresh_token']`,
  spawns a localhost HTTP listener for the OAuth callback, and exchanges
  the resulting code for a long-lived refresh token. Browser-already-signed-in
  case is one click on Allow.
- **Silent token refresh** — `ensureFreshToken` exchanges the cached refresh
  token for a new access token whenever you're within 5 minutes of expiry.
  Effective session length is now the refresh-token TTL (~90 days for the
  standard `sso:account:access` scope), not the access-token TTL (~1 hour).
- **Custom SSO credential resolver** in `src/main/aws/credentials.ts` —
  bypasses `fromIni`'s lazy-require of `@aws-sdk/credential-provider-sso`,
  which was unreliable in a bundled Electron main process. Fixes "Could not
  resolve credentials using profile" errors on otherwise-valid SSO profiles.
- **Cache file `awssistFlow` marker** distinguishes refresh-capable caches
  from legacy device-flow ones; on a successful refresh we *promote* the
  marker so even older caches upgrade themselves the first time they need
  to renew.

### Reliability

- **Tunnel teardown actually kills the SSM plugin.** Spawning with
  `detached: true` puts the `aws ssm start-session` wrapper and its
  `session-manager-plugin` grandchild into a shared process group; Stop
  signals the whole group (SIGTERM, escalating to SIGKILL after 3 s).
  Stale `session-manager-plugin` processes holding port 5432 / 6380 are
  no longer a thing.
- **Removed `node-pty` and the embedded xterm.** ECS exec and SSM both open
  the OS-native terminal now (Terminal.app on macOS, `cmd.exe`/Windows
  Terminal on Windows, the user's detected terminal on Linux). No PTY
  emulation in-app, so sessions can't freeze or desync.
- **Main-process → renderer log bridge.** `console.{log,warn,error}` in main
  is patched to also broadcast each line to the renderer; appears in
  DevTools with a `[main]` prefix. Otherwise main-process output is
  invisible in a packaged app launched via `open`.
- **Reinstall script** (`scripts/reinstall-mac.sh`, exposed as
  `npm run reinstall:mac` and `npm run build:reinstall:mac`) replaces
  `/Applications/AWSsist.app` on every dev iteration so Spotlight /
  Launchpad / ⌘-Tab always show exactly one AWSsist.

### Internal

- **Electron 33 → 42**, bundling **Node 22**. Heads off the AWS SDK
  v3 deprecation notice that kicked in for Node < 22 starting January 2027.
- **Build matrix** — `dist:mac`, `dist:win`, `dist:linux`, `dist:all`,
  plus `build:reinstall:mac` for dev. `.deb` available via `dist:linux:full`
  on Linux hosts only.
- **Renamed bundle id** to `com.awssist.app` and product name to AWSsist.
  v0.1.0 was distributed under both `AWSnator` and `AWSsist` for one build;
  this is the first build under the single canonical name end-to-end.

### Known limitations carried over from v0.1.0

- **No code signing.** macOS Gatekeeper still flags downloads as
  "damaged" — workaround `xattr -cr /Applications/AWSsist.app`. The
  electron-builder config is wired for Developer ID + notarization;
  drop the five env vars in (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) and `npm run dist:mac`
  produces a signed + notarized DMG. Tracked in our internal task list.
- **Windows installers unsigned** — SmartScreen warns on first launch.
- **Bastion auto-detection** still keys off `Name=*bastion*` tag.

### Upgrading from v0.1.0

- macOS: download the new `.dmg`, drag to Applications (replacing v0.1.0).
  Run `xattr -cr /Applications/AWSsist.app` once to clear the Gatekeeper
  quarantine flag.
- Windows / Linux: download and install the new artifact; previous version
  uninstall is optional but recommended.
- Existing SSO sessions in `~/.aws/sso/cache/*.json` will continue to work
  but won't gain refresh-token longevity until you click Sign In once on
  the SSO card (writes a new refresh-capable cache with the
  `awssistFlow: 'auth_code_pkce'` marker).

---

## v0.1.0 — first release · 2026-05-25

The initial public build. AWSsist replaces the team's collection of shell
scripts (`login.sh`, `connect_db.sh`, `connect_redis.sh`, `connect_task_shell.sh`,
etc.) with a single desktop app that talks to `~/.aws/config` directly and
opens shells / tunnels through your native terminal.

### Highlights

- **Single sign-in, every account at once.** Add your SSO start URL once,
  click Sign in, then bulk-import every account × role pair you have access
  to as profiles in `~/.aws/config` — name them how you want, no more typing
  out account IDs by hand.
- **EC2 / ECS / RDS / Redis browsers** across all profiles and regions, with
  live STS identity verification so you always know whose credentials are in
  flight.
- **Native-terminal sessions** for SSM (EC2) and ECS exec — Terminal.app on
  macOS, your DE's terminal on Linux, `cmd.exe` on Windows. No embedded
  pseudo-TTY, so sessions can't freeze or desync.
- **One-click SSM port-forwarding tunnels** for RDS (writer/reader) and
  ElastiCache (Redis/Valkey) endpoints. Auto-detects bastion EC2 hosts by
  tag and lets you pick when more than one exists.
- **Clean tunnel teardown** — Stop kills the whole `aws` + `session-manager-plugin`
  process group, so the local port is reusable immediately. No more
  orphaned listeners holding 5432/6380.
- **Cross-platform installers** built from a single macOS host: `.dmg` for
  macOS, `.exe` (NSIS installer + portable) for Windows, AppImage for Linux.
- **Dark / Light / System theme** with proper token-based theming — every
  surface honours the active theme.

### What's included

| Area | Detail |
| --- | --- |
| Auth | SSO via OIDC device-authorization flow (in-process), shared `~/.aws/sso/cache` with aws CLI / boto3 / SDKs |
| Profiles | SSO (federated), IAM User (with optional MFA), Role chain (with optional MFA + external ID); per-profile region; optional Session Alias persisted to `~/.aws/awssist.json` |
| Sessions | Short-lived STS creds written to `~/.aws/credentials` for external tools; auto-expiry tracker |
| EC2 | List, search by name/id/IP/tag, per-instance SSM session in native terminal |
| ECS | Cluster / service / task / container browser, container shell in native terminal |
| RDS | Aurora / RDS cluster listing with reader + writer endpoints |
| ElastiCache | Redis / Valkey node listing |
| Tunnels | SSM port-forwarding via bastion EC2; bastion picker modal; live status; clean teardown |
| Theme | Light / System / Dark, CSS-variable tokens |
| App icon | Shield artwork — Apple-style rounded square in Finder / Dock / Applications |

### Build matrix

| Platform | File | Arch |
| --- | --- | --- |
| macOS | `AWSsist-0.1.0-arm64.dmg` | Apple Silicon |
| Windows | `AWSsist-Setup-0.1.0-x64.exe` | x64 NSIS |
| Windows | `AWSsist-Setup-0.1.0-arm64.exe` | arm64 NSIS |
| Windows | `AWSsist-0.1.0-portable-x64.exe` | x64 portable |
| Linux | `AWSsist-0.1.0-x86_64.AppImage` | x64 |
| Linux | `AWSsist-0.1.0-arm64.AppImage` | arm64 |

### External requirements

Both runtime dependencies are detected on startup; the sidebar surfaces a
warning when either is missing.

- **AWS CLI v2** — used for SSM port-forwarding tunnels, SSM sessions, and
  ECS `execute-command`. AWSsist talks to the SDK directly for everything
  else (listing, credentials, SSO sign-in).
- **`session-manager-plugin`** — required by AWS for any `aws ssm start-session`
  invocation. Bundled separately from the aws CLI on every platform.

### Known limitations

- **No code signing.** Builds are unsigned to keep the repo portable. macOS
  Gatekeeper and Windows SmartScreen will warn on first open; users have to
  right-click → Open (macOS) or click "More info → Run anyway" (Windows).
- **`.deb` not cross-compiled.** The upstream `fpm` shipped with
  electron-builder produces invalid `.deb` archives on Apple Silicon; the
  default Linux build only ships AppImage (which works on every distro).
  Run `npm run dist:linux:full` on a Linux host if you specifically need
  `.deb`.
- **Bastion auto-detection requires a `Name=*bastion*` tag.** If your hosts
  use a different naming convention, you'll see "No bastion EC2 instances
  found" in the tunnel dialog. Workaround: rename / re-tag the host, or
  open an issue and we'll add a tag-key setting.
- **MFA-protected static profiles only get the MFA ARN written** — AWSsist
  doesn't prompt for a TOTP code yet; tools that respect `mfa_serial` will
  prompt themselves.

### Roadmap (open for prioritisation)

- AWS Console deep-link per profile (federated sign-in URL → specific
  account/role, not the SSO start page).
- Settings: customisable bastion-detection tag.
- Per-profile region override for resource tabs (currently a global region
  picker per tab).
- AWS account alias (display name) discovery from the SSO API so the
  importer can pre-fill nicer defaults.
- Apple Developer + Authenticode signing in CI for public distribution.
- Auto-update via electron-builder's `latest-*.yml` channel.
- Windows Terminal (`wt.exe`) detection on Windows for nicer in-terminal
  sessions when present.

### Acknowledgements

The script names and account-naming conventions are inherited from the
team's existing `social-api/toolbox/` collection — AWSsist is a UI on top
of that workflow, not a replacement.
