import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

export async function openFileWithDefaultApp(path: string): Promise<void> {
  await openPath(path);
}

export async function revealFileInFinder(path: string): Promise<void> {
  await revealItemInDir(path);
}
