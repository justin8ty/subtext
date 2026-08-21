import { homedir } from "node:os";
import { join } from "node:path";

const APP_DATA_DIRECTORY_NAME = ".watchless";

export function defaultAppDataDirectory(): string {
  return join(homedir(), APP_DATA_DIRECTORY_NAME);
}
