// @effect-diagnostics nodeBuiltinImport:off -- Uses node builtins for unsigned macOS .app update extraction and handoff.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Electron from "electron";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { AppImageUpdater, MacUpdater, autoUpdater } from "electron-updater";

type AutoUpdater = typeof autoUpdater;
type SpawnLog = (cmd: string, args?: Array<string>, ...rest: Array<unknown>) => Promise<boolean>;

interface MacUpdateDownloadedEvent {
  readonly downloadedFile: string;
}

interface MacUpdaterInternals {
  updateDownloaded: (
    zipFileInfo: unknown,
    event: MacUpdateDownloadedEvent,
  ) => Promise<Array<string>>;
  dispatchUpdateDownloaded: (event: MacUpdateDownloadedEvent) => void;
}

// Electron holds the AppImage runtime's keepalive pipe and some files without O_CLOEXEC; a
// relaunched AppImage inherits them, so old runtimes and FUSE mounts never exit. bash (AppRun
// already needs it; dash cannot close multi-digit fds) closes them before exec'ing the AppImage.
// -p skips BASH_ENV and exported functions in the helper only; the AppImage still receives both.
const CLOSE_INHERITED_FDS_THEN_EXEC =
  'for fd in /proc/self/fd/*; do fd=${fd##*/}; case $fd in *[!0-9]*|[012]) ;; *) eval "exec $fd>&-" ;; esac; done; exec "$@"';

const SWAP_MAC_APP_AND_RELAUNCH = [
  'pid="$1"',
  'target="$2"',
  'source_app="$3"',
  'temp_dir="$4"',
  'relaunch="$5"',
  "i=0",
  'while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 150 ]; do',
  "  sleep 0.2",
  "  i=$((i + 1))",
  "done",
  'backup="${target}.miasma-backup.$$"',
  'rm -rf "$backup"',
  'if mv "$target" "$backup"; then',
  '  if mv "$source_app" "$target"; then',
  '    rm -rf "$backup"',
  "  else",
  '    mv "$backup" "$target"',
  '    rm -rf "$temp_dir"',
  "    exit 1",
  "  fi",
  "else",
  '  rm -rf "$temp_dir"',
  "  exit 1",
  "fi",
  'rm -rf "$temp_dir"',
  'xattr -dr com.apple.quarantine "$target" 2>/dev/null || true',
  'if [ "$relaunch" = "1" ]; then',
  '  open -n "$target"',
  "fi",
].join("\n");

export function resolveMacAppBundlePath(execPath: string): string | null {
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  return match?.[1] ?? null;
}

export function isMacAppDeveloperIdSignedOutput(codesignOutput: string): boolean {
  return /Authority=Developer ID Application:/i.test(codesignOutput);
}

function isMacAppDeveloperIdSigned(appBundlePath: string): boolean {
  try {
    const result = NodeChildProcess.spawnSync("codesign", ["-dv", "--verbose=2", appBundlePath], {
      encoding: "utf8",
    });
    if (result.status !== 0) return false;
    return isMacAppDeveloperIdSignedOutput(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  } catch {
    return false;
  }
}

function extractMacAppFromUpdateZip(zipPath: string): {
  readonly extractDir: string;
  readonly extractedAppPath: string;
} {
  if (!NodeFS.existsSync(zipPath)) {
    throw new Error(`Downloaded update archive does not exist at ${zipPath}.`);
  }
  const extractDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "miasma-update-"));
  try {
    NodeChildProcess.execFileSync("ditto", ["-xk", zipPath, extractDir], {
      stdio: "ignore",
    });
    const appEntry = NodeFS.readdirSync(extractDir).find((entry) => entry.endsWith(".app"));
    if (appEntry === undefined) {
      throw new Error("Downloaded macOS update archive did not contain a .app bundle.");
    }
    return {
      extractDir,
      extractedAppPath: NodePath.join(extractDir, appEntry),
    };
  } catch (error) {
    NodeFS.rmSync(extractDir, { recursive: true, force: true });
    throw error;
  }
}

let unsignedMacPatched = false;
let unsignedMacAppBundlePath: string | null = null;
let unsignedMacDownloadedZipPath: string | null = null;

// Squirrel.Mac rejects updates for unsigned/ad-hoc signed macOS builds. When the packaged app has
// no Developer ID signature, preserve electron-updater's SHA-512 download verification and replace
// the .app bundle directly on quit.
function ensureUnsignedMacUpdaterConfigured(updater: AutoUpdater): void {
  if (unsignedMacPatched) return;
  if (HostProcess.Platform.defaultValue() !== "darwin" || !(updater instanceof MacUpdater)) return;
  const appBundlePath = resolveMacAppBundlePath(process.execPath);
  if (appBundlePath === null || !Electron.app.isPackaged) return;
  if (isMacAppDeveloperIdSigned(appBundlePath)) return;

  unsignedMacPatched = true;
  unsignedMacAppBundlePath = appBundlePath;
  const macUpdater = updater as unknown as MacUpdaterInternals;
  macUpdater.updateDownloaded = async function (_zipFileInfo, event) {
    unsignedMacDownloadedZipPath = event.downloadedFile;
    this.dispatchUpdateDownloaded(event);
    return [];
  };
}

function quitAndInstallUnsignedMacUpdate(isForceRunAfter: boolean): void {
  if (unsignedMacAppBundlePath === null || unsignedMacDownloadedZipPath === null) {
    throw new Error("No verified macOS update archive is ready to install.");
  }
  const targetDir = NodePath.dirname(unsignedMacAppBundlePath);
  try {
    NodeFS.accessSync(targetDir, NodeFS.constants.W_OK);
  } catch {
    throw new Error("Move Miasma.app into /Applications before installing updates.");
  }
  const { extractDir, extractedAppPath } = extractMacAppFromUpdateZip(unsignedMacDownloadedZipPath);
  const child = NodeChildProcess.spawn(
    "/bin/sh",
    [
      "-c",
      SWAP_MAC_APP_AND_RELAUNCH,
      "miasma-updater",
      String(process.pid),
      unsignedMacAppBundlePath,
      extractedAppPath,
      extractDir,
      isForceRunAfter ? "1" : "0",
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  Electron.app.quit();
}

const relaunchWithoutInheritedDescriptors = (updater: AppImageUpdater) => {
  const spawnLog = (AppImageUpdater.prototype as unknown as { spawnLog: SpawnLog }).spawnLog;
  (updater as unknown as { spawnLog: SpawnLog }).spawnLog = function (cmd, args = [], ...rest) {
    return spawnLog.call(
      this,
      "bash",
      ["-p", "-c", CLOSE_INHERITED_FDS_THEN_EXEC, cmd, cmd, ...args],
      ...rest,
    );
  };
};

export type ElectronUpdaterFeedUrl = Parameters<AutoUpdater["setFeedURL"]>[0];

export class ElectronUpdaterCheckForUpdatesError extends Schema.TaggedError<ElectronUpdaterCheckForUpdatesError>()(
  "ElectronUpdaterCheckForUpdatesError",
  {
    channel: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to check for updates on channel ${this.channel ?? "default"}.`;
  }
}

export class ElectronUpdaterDownloadUpdateError extends Schema.TaggedError<ElectronUpdaterDownloadUpdateError>()(
  "ElectronUpdaterDownloadUpdateError",
  {
    channel: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to download the update on channel ${this.channel ?? "default"}.`;
  }
}

export class ElectronUpdaterQuitAndInstallError extends Schema.TaggedError<ElectronUpdaterQuitAndInstallError>()(
  "ElectronUpdaterQuitAndInstallError",
  {
    channel: Schema.NullOr(Schema.String),
    isSilent: Schema.Boolean,
    isForceRunAfter: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to quit and install the update on channel ${this.channel ?? "default"} (silent: ${this.isSilent}, force run after: ${this.isForceRunAfter}).`;
  }
}

export const ElectronUpdaterError = Schema.Union([
  ElectronUpdaterCheckForUpdatesError,
  ElectronUpdaterDownloadUpdateError,
  ElectronUpdaterQuitAndInstallError,
]);
export type ElectronUpdaterError = typeof ElectronUpdaterError.Type;

export class ElectronUpdater extends Context.Service<
  ElectronUpdater,
  {
    readonly setFeedURL: (options: ElectronUpdaterFeedUrl) => Effect.Effect<void>;
    readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
    readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
    readonly setChannel: (channel: string) => Effect.Effect<void>;
    readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
    readonly allowDowngrade: Effect.Effect<boolean>;
    readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
    readonly setFullChangelog: (value: boolean) => Effect.Effect<void>;
    readonly setDisableDifferentialDownload: (value: boolean) => Effect.Effect<void>;
    readonly checkForUpdates: Effect.Effect<void, ElectronUpdaterCheckForUpdatesError>;
    readonly downloadUpdate: Effect.Effect<void, ElectronUpdaterDownloadUpdateError>;
    readonly quitAndInstall: (options: {
      readonly isSilent: boolean;
      readonly isForceRunAfter: boolean;
    }) => Effect.Effect<void, ElectronUpdaterQuitAndInstallError>;
    readonly on: <Args extends ReadonlyArray<unknown>>(
      eventName: string,
      listener: (...args: Args) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronUpdater") {}

/** @public */
export const make = ElectronUpdater.of({
  setFeedURL: Effect.fn("ElectronUpdater.setFeedURL")(function (options) {
    return Effect.suspend(() => {
      autoUpdater.setFeedURL(options);
      return Effect.void;
    });
  }),
  setAutoDownload: Effect.fn("ElectronUpdater.setAutoDownload")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.autoDownload = value;
      return Effect.void;
    });
  }),
  setAutoInstallOnAppQuit: Effect.fn("ElectronUpdater.setAutoInstallOnAppQuit")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.autoInstallOnAppQuit = value;
      return Effect.void;
    });
  }),
  setChannel: Effect.fn("ElectronUpdater.setChannel")(function (channel) {
    return Effect.suspend(() => {
      autoUpdater.channel = channel;
      return Effect.void;
    });
  }),
  setAllowPrerelease: Effect.fn("ElectronUpdater.setAllowPrerelease")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.allowPrerelease = value;
      return Effect.void;
    });
  }),
  allowDowngrade: Effect.sync(() => autoUpdater.allowDowngrade),
  setAllowDowngrade: Effect.fn("ElectronUpdater.setAllowDowngrade")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.allowDowngrade = value;
      return Effect.void;
    });
  }),
  setFullChangelog: Effect.fn("ElectronUpdater.setFullChangelog")(function (value) {
    return Effect.suspend(() => {
      autoUpdater.fullChangelog = value;
      return Effect.void;
    });
  }),
  setDisableDifferentialDownload: Effect.fn("ElectronUpdater.setDisableDifferentialDownload")(
    function (value) {
      return Effect.suspend(() => {
        autoUpdater.disableDifferentialDownload = value;
        return Effect.void;
      });
    },
  ),
  checkForUpdates: Effect.suspend(() => {
    ensureUnsignedMacUpdaterConfigured(autoUpdater);
    const channel = autoUpdater.channel;
    return Effect.tryPromise({
      try: () => autoUpdater.checkForUpdates(),
      catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ channel, cause }),
    }).pipe(Effect.asVoid);
  }),
  downloadUpdate: Effect.suspend(() => {
    ensureUnsignedMacUpdaterConfigured(autoUpdater);
    const channel = autoUpdater.channel;
    return Effect.tryPromise({
      try: () => autoUpdater.downloadUpdate(),
      catch: (cause) => new ElectronUpdaterDownloadUpdateError({ channel, cause }),
    }).pipe(Effect.asVoid);
  }),
  quitAndInstall: Effect.fn("ElectronUpdater.quitAndInstall")(function ({
    isSilent,
    isForceRunAfter,
  }) {
    return Effect.suspend(() => {
      ensureUnsignedMacUpdaterConfigured(autoUpdater);
      const channel = autoUpdater.channel;
      if (autoUpdater instanceof AppImageUpdater) relaunchWithoutInheritedDescriptors(autoUpdater);
      return Effect.try({
        try: () => {
          if (unsignedMacPatched) {
            quitAndInstallUnsignedMacUpdate(isForceRunAfter);
            return;
          }
          autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
        },
        catch: (cause) =>
          new ElectronUpdaterQuitAndInstallError({
            channel,
            isSilent,
            isForceRunAfter,
            cause,
          }),
      });
    });
  }),
  on: Effect.fn("ElectronUpdater.on")(function (eventName, listener) {
    const eventTarget = autoUpdater as unknown as {
      on: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
      removeListener: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
    };
    const untypedListener = listener as unknown as (...args: Array<unknown>) => void;
    return Effect.acquireRelease(
      Effect.sync(() => {
        eventTarget.on(eventName, untypedListener);
      }),
      () =>
        Effect.sync(() => {
          eventTarget.removeListener(eventName, untypedListener);
        }),
    ).pipe(Effect.asVoid);
  }),
});

export const layer = Layer.succeed(ElectronUpdater, make);
