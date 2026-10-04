/**
 * The operating-system actions Archie needs that Node's `fs` can't do. The app (Electron main) supplies
 * the real one by passing Electron's `shell`; tests use `FakeFsShell` (src/main/testing/fakeFsShell.ts),
 * so no test ever opens a program, shows Explorer, or touches the Recycle Bin.
 */
export interface FsShell {
  /** Open a file with its default app. Resolves '' on success, otherwise an error message (Electron's `shell.openPath`). */
  openPath(abs: string): Promise<string>;
  /** Show a file selected in File Explorer (Electron's `shell.showItemInFolder`). */
  showItemInFolder(abs: string): void;
  /** Move a file or folder to the Windows Recycle Bin (Electron's `shell.trashItem`). Only the 7-day trash sweep may use this. */
  trashItem(abs: string): Promise<void>;
}
