# AWSsist Release Notes

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
