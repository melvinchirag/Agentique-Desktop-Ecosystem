import type { FsShell } from '../connectors/fs/fsShell';

/** Records every call and touches nothing. `failOpen` / `failTrash` make the next calls fail, to test error paths. */
export class FakeFsShell implements FsShell {
  readonly opened: string[] = [];
  readonly revealed: string[] = [];
  readonly trashed: string[] = [];
  /** When set, openPath resolves this error message instead of ''. */
  failOpen: string | undefined;
  /** When set, trashItem rejects with this message. */
  failTrash: string | undefined;

  async openPath(abs: string): Promise<string> {
    this.opened.push(abs);
    return this.failOpen ?? '';
  }

  showItemInFolder(abs: string): void {
    this.revealed.push(abs);
  }

  async trashItem(abs: string): Promise<void> {
    if (this.failTrash !== undefined) throw new Error(this.failTrash);
    this.trashed.push(abs);
  }
}
