import { realpath } from "node:fs/promises";

const CHOOSE_FOLDER = `try
  set selectedFolder to choose folder with prompt "Select a Git repository for DevQuest"
  return POSIX path of selectedFolder
on error number -128
  return ""
end try`;

export class FolderPicker {
  constructor({ runner, platform = process.platform }) {
    this.runner = runner;
    this.platform = platform;
    this.busy = false;
  }
  async choose() {
    if (this.platform !== "darwin")
      return {
        unavailable: true,
        message:
          "Native folder browsing requires macOS. Enter a path manually and check it.",
      };
    if (this.busy) throw new Error("A folder dialog is already open");
    this.busy = true;
    try {
      const result = await this.runner(
        "/usr/bin/osascript",
        ["-e", CHOOSE_FOLDER],
        { timeoutMs: 120000, maxOutput: 8192 },
      );
      if (result.code !== 0)
        throw new Error("The macOS folder dialog could not be opened");
      const selected = result.stdout.replace(/\r?\n$/, "");
      return selected
        ? { path: await realpath(selected) }
        : { cancelled: true };
    } catch {
      return {
        unavailable: true,
        message:
          "Folder browsing is unavailable. Check that DevQuest has a macOS graphical session, or enter a path manually and check it.",
      };
    } finally {
      this.busy = false;
    }
  }
}
