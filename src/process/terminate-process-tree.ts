import { spawn, type ChildProcess } from "node:child_process";

export function terminateProcessTree(child: ChildProcess): Promise<void> {
  const processId = child.pid;
  if (processId === undefined || processId <= 0) {
    child.kill();
    return Promise.resolve();
  }
  if (process.platform !== "win32") {
    child.kill();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const taskkill = spawn("taskkill.exe", ["/pid", processId.toString(), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      child.kill();
      resolve();
    };
    taskkill.once("error", finish);
    taskkill.once("close", finish);
  });
}
