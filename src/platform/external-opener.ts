import { spawn } from "node:child_process";

export interface ExternalOpener {
  open(target: string): Promise<void>;
}

export class ExternalOpenError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExternalOpenError";
  }
}

export class SystemExternalOpener implements ExternalOpener {
  async open(target: string): Promise<void> {
    try {
      if (process.platform === "win32") {
        await spawnDetached("explorer.exe", [target]);
        return;
      }
      if (process.env.WSL_DISTRO_NAME !== undefined) {
        const windowsTarget = isUrl(target) ? target : await convertWslPath(target);
        await spawnDetached("explorer.exe", [windowsTarget]);
        return;
      }
      if (process.platform === "darwin") {
        await spawnDetached("open", [target]);
        return;
      }
      await spawnDetached("xdg-open", [target]);
    } catch (error) {
      throw new ExternalOpenError(`Could not open ${target}.`, { cause: error });
    }
  }
}

function isUrl(target: string): boolean {
  return /^https?:\/\//iu.test(target);
}

function convertWslPath(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("wslpath", ["-w", path], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || "wslpath failed."));
        return;
      }
      const converted = Buffer.concat(stdout).toString("utf8").trim();
      if (converted === "") {
        reject(new Error("wslpath returned an empty path."));
        return;
      }
      resolve(converted);
    });
  });
}

function spawnDetached(executable: string, arguments_: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      detached: true,
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
