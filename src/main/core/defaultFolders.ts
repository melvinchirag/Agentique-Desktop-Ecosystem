import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize } from 'node:path';

export interface KnownFolders {
  desktop?: string;
  documents?: string;
  downloads?: string;
  home?: string;
  oneDrive?: string;
}

/** Electron's known folders come first; include existing local and OneDrive counterparts. */
export function defaultFolders(folders: KnownFolders): { allowed: string[]; documentsRoot: string } {
  const home = folders.home ?? homedir();
  const oneDrive = folders.oneDrive ?? process.env.OneDrive ?? join(home, 'OneDrive');
  const choices = [
    [folders.desktop, join(oneDrive, 'Desktop'), join(home, 'Desktop')],
    [folders.documents, join(oneDrive, 'Documents'), join(home, 'Documents')],
    [folders.downloads, join(oneDrive, 'Downloads'), join(home, 'Downloads')],
  ];
  const unique = (paths: (string | undefined)[]): string[] => [...new Map(paths
    .filter((p): p is string => !!p && existsSync(p))
    .map(p => [normalize(p).toLowerCase(), normalize(p)])).values()];
  const allowed = unique(choices.flat());
  const documentsRoot = unique(choices[1]!)[0] ?? folders.documents ?? join(home, 'Documents');
  return { allowed, documentsRoot };
}
