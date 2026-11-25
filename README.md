<p align="center">
  <a href="https://github.com/zyfvhcfh87-rgb/miasma">
    <img src="./assets/prod/t3-black-web-icon-192x192.png" width="84" height="84" alt="Miasma logo" />
  </a>
</p>

<h1 align="center">Miasma</h1>

<p align="center">An open-source desktop &amp; web control plane for coding agents.</p>

<p align="center">
  <a href="https://github.com/zyfvhcfh87-rgb/miasma/releases"><strong>Download</strong></a> ·
  <a href="https://github.com/zyfvhcfh87-rgb/miasma/issues">Issues</a>
</p>

Miasma runs the coding agents installed on your machine and brings them into one fast desktop and web interface. It works with Claude Code, Codex, Cursor, OpenCode, Grok Build, Antigravity, Kiro, Pi, Muse Code, Mistral Vibe, and any ACP agent.

## Highlights

- **Bring your own subscriptions.** Drives the coding agents you are already signed in to locally — no token reselling.
- **Inline composer usage meter.** Shows live 5-hour / weekly quota remaining (`% left`) and monthly budget spend (including Mistral Vibe `$spent / $limit`) right beneath the thread composer, with one-click refresh and a toggle in **Settings → Appearance**.
- **Isolated local data.** Stores its state in `~/.miasma`, completely separate from any other coding agent GUI on your machine.
- **Git worktrees & diffs built in.** Run threads in isolated branches/worktrees, inspect diffs, commit, and open PRs from one place.
- **Self-contained GitHub Releases updates.** Packaged Miasma builds check for and install updates exclusively from [`zyfvhcfh87-rgb/miasma` Releases](https://github.com/zyfvhcfh87-rgb/miasma/releases).

## Install

Download the latest `.dmg` (macOS Apple Silicon) or installer from [Releases](https://github.com/zyfvhcfh87-rgb/miasma/releases), drag **Miasma** into `/Applications`, and launch.

## Building from source

```bash
vp install
vp run dev
```

To build a packaged macOS `.dmg` + auto-update `.zip` and `latest-mac.yml`:

```bash
vp run dist:desktop:dmg:arm64
```

Outputs are written to `release/`.

## License & attribution

The source code in this repository is licensed under the [MIT License](./LICENSE).

> **Unofficial fork notice:** Miasma is an independent, unofficial fork derived from the open-source T3 Code codebase and is **not** affiliated with, endorsed by, or sponsored by T3 Tools, Inc.
