// Optional auto-update support via electron-updater.
//
// When the app is packaged and a publish feed is configured (see the `publish`
// block in electron-builder.yml — GitHub Releases by default), the app checks
// for a newer release on launch, downloads it in the background, and installs
// it on the next quit. If electron-updater isn't installed or no feed is
// configured, this is a silent no-op.

const { app, dialog } = require("electron");

function initAutoUpdates() {
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    return; // electron-updater not installed — skip.
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", async (info) => {
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      title: "Update ready",
      message: `Household Finance ${info.version} has been downloaded.`,
      detail: "Restart to apply the update. Your data is preserved.",
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on("error", () => { /* non-fatal — ignore update failures */ });

  // Don't crash startup if the feed is unreachable.
  autoUpdater.checkForUpdates().catch(() => { /* ignore */ });
}

module.exports = { initAutoUpdates };
