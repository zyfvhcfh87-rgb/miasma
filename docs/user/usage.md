# Usage

Open **Usage** from the sidebar or the command palette, or press `mod+u` on web and
desktop when the terminal is not focused. Customize `usage.open` in
**Settings → Keybindings**.

On mobile, choose **Usage** in the workspace navigation.

## Understand your usage

**Usage** combines Codex, Claude Code, Grok Build, OpenCode, Antigravity, Pi, Muse Code, and Cursor history
from your connected environments. It shows token use, cache savings, model breakdowns, and estimated API-equivalent
cost, split by token type and by speed. These estimates are not your subscription bill.
**Premium** is what Fast and Ultrafast requests cost above standard rates. Cost that cannot be
split, such as a provider-reported cost for a model without public rates, shows as **Other**.
Select a model under **Breakdown** to see its trend, cache hit rate, and cost per million tokens.

Totals depend on the history available on each server. Grok turns without a saved completed-turn
record are missing from the totals.
Text generation (thread titles, commit messages, PR text, branch names and review guides) is not in
the totals for Codex or Claude Code 2.0.63 and newer, because those runs save no session history.

The server keeps scanned usage history for 92 days by default. Claude Code deletes its own
transcripts after 30 days, so for older Claude usage this history is the only record left. To keep
it longer, set `usageHistoryRetentionDays` in `<T3 home>/userdata/settings.json` to a number of days
such as `365`, or to `"unlimited"`. Usage views still show at most 90 days. Lowering the value
prunes older history on the next refresh, and raising it again does not bring pruned history back.
While `settings.json` cannot be read, nothing is pruned.

OpenCode reads its SQLite database and older JSON history. Antigravity reads local conversation
databases, including T3-managed profiles. Set `OPENCODE_DATA_DIR` or `ANTIGRAVITY_DATA_DIR` on the
server to read a different data directory; comma-separated paths read multiple directories.

Cursor reads account usage from Cursor's API for the account you signed in with in T3 or set as
`CURSOR_API_KEY`. This includes headless T3 sessions and desktop usage across machines; the same
account counts once across connected environments. T3 does not estimate missing tokens from
conversation text.

Usage includes each configured account's history, including disabled accounts. Custom homes follow
the account's home setting or its `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, or `GROK_HOME` environment
variable. Pi reads `~/.pi/agent/sessions`, or the `sessions` directory under
`PI_CODING_AGENT_DIR`. Set `PI_CODING_AGENT_SESSION_DIR` to read a different session directory.
To include sessions saved through `--session-dir` or Pi's `sessionDir` setting, set this environment
variable to the same directory. Pi includes recorded tool and summary costs under `Tools/summaries`.
Muse Code reads native session history, including child sessions, from the home reported by the
configured Muse CLI. Its environment settings, including `XDG_DATA_HOME`, apply. Models without
known prices still contribute tokens and appear as unpriced; set custom prices to estimate their cost.
Use absolute paths or `~/` paths in the account's environment settings; relative environment paths
depend on each project's working directory and cannot be reliably discovered by Usage. Accounts
sharing a history directory count once.

The server saves its first hostname in `<T3 home>/usage-host-id`, so a recreated container keeps
its usage identity when T3 home is persisted. Set `T3CODE_HOST_ID` to choose the identity
explicitly.

When your app and server support different providers, usage totals may cover only the providers
your app understands. Update the app to include newly supported providers.

On web and desktop, use the environment dropdown to filter costs and tokens. All
environments are selected by default. The dropdown shows which environments are still scanning;
results appear as each one responds, and figures still updating are dimmed. Cursor shows its last
saved totals first, then updates them when Cursor's API responds.

If recent work is missing or a new model shows no cost, refresh to rescan session history and
update model pricing.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing. When a model on **Usage** has no known price, select it under
**Breakdown** and choose **Set price** to open this table with that model added.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

To count one model as another, such as a preview model under its released name, enter the target
model ID under **Map to**. The mapped model no longer appears on **Usage**: its tokens and cost
move to the target model and use the target's price. Clear **Map to** or reset the row to show
the model on its own again.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Show only some models

To count only some models, or to leave some out, add `usageModelFilter` to the server's
`settings.json` in its `userdata` directory, such as `~/.t3/userdata/settings.json`:

```json
{
  "usageModelFilter": {
    "include": [{ "provider": "claude", "model": "orbit-1" }, { "model": "orbit-2" }],
    "exclude": [{ "model": "drift-9" }]
  }
}
```

`include` keeps only the listed models and `exclude` leaves the listed models out. `provider` is
one of `claude`, `codex`, `cursor`, `grok`, `opencode`, `antigravity`, `pi`, or `muse`; omit it
to match a model ID from any provider. Use the model ID that Usage shows without **Map to**, such
as a provider-prefixed ID for Pi. Filters apply before **Map to**, so a model you leave out is not
counted under its mapped name. Usage applies each environment's own filter. Remove the setting to
show every model again.

If the setting is invalid, Usage ignores it and shows every model, and the next save of any other
setting removes it from `settings.json`.

## Keyboard shortcuts

On web and desktop, open Usage from the command palette. While on Usage,
press `C` or `T` for Cost or Tokens while not typing in a field.
Use `Ctrl+Shift+1/2/3/4` (`Cmd+Shift+1/2/3/4` on macOS) for the past
24 hours, 7 days, 30 days, or 90 days.
Press `Escape` to return to the previous page. Customize these shortcuts in
**Settings → Keybindings**.
