import { mkdir, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Paths created by {@link makeSandbox}. `symlink` is absent when the host disallows links. */
export interface SandboxFixture {
  root: string;
  desktop: string;
  documents: string;
  downloads: string;
  adeTrash: string;
  freshFile: string;
  executable: string;
  gitFolder: string;
  outsidePrefix: string;
  outsideSecret: string;
  symlink?: string;
}

/**
 * Build an isolated ADE file fixture under `parentDir` without touching user folders.
 * Downloads contains 60 mixed files, a two-minute-old fresh file, an executable, and
 * a `.git` tree. `Downloads2` and its secret are siblings of `Downloads`, reproducing
 * the string-prefix sandbox escape case. Symlink creation is best-effort on Windows.
 */
export async function makeSandbox(parentDir: string, now = Date.now()): Promise<SandboxFixture> {
  const root = path.join(path.resolve(parentDir), 'sandbox');
  const desktop = path.join(root, 'Desktop');
  const documents = path.join(root, 'Documents');
  const downloads = path.join(root, 'Downloads');
  const adeTrash = path.join(documents, 'ADE Trash');
  const gitFolder = path.join(downloads, '.git');
  const outsidePrefix = path.join(root, 'Downloads2');
  const outsideSecret = path.join(outsidePrefix, 'secret.txt');

  await Promise.all([
    mkdir(desktop, { recursive: true }),
    mkdir(adeTrash, { recursive: true }),
    mkdir(gitFolder, { recursive: true }),
    mkdir(outsidePrefix, { recursive: true }),
    mkdir(downloads, { recursive: true }),
  ]);
  await writeFile(path.join(desktop, 'notes.txt'), 'Fixture notes for ADE tests.\n');
  await writeFile(path.join(documents, 'resume.pdf'), '%PDF fixture resume');
  await writeFile(path.join(gitFolder, 'config'), '[core]\n');
  await writeFile(outsideSecret, 'outside the Downloads root');

  const extensions = ['.pdf', '.png', '.jpg', '.txt', '.docx', '.csv', '.zip', '.mp3', '.mp4', '.ts'];
  for (let i = 0; i < 60; i += 1) {
    const ext = extensions[i % extensions.length];
    await writeFile(path.join(downloads, `fixture-${String(i + 1).padStart(2, '0')}${ext}`), `fixture ${i + 1}\n`);
  }

  const freshFile = path.join(downloads, 'fresh-file.txt');
  await writeFile(freshFile, 'recently modified fixture');
  const freshTime = new Date(now - 2 * 60 * 1000);
  await utimes(freshFile, freshTime, freshTime);
  const executable = path.join(downloads, 'setup.exe');
  await writeFile(executable, 'fixture executable; never run');

  const linkPath = path.join(downloads, 'outside-link.txt');
  let linkCreated = false;
  try {
    await symlink(outsideSecret, linkPath, 'file');
    linkCreated = true;
  } catch {
    // Symlink creation is not available on every Windows test host.
  }

  return {
    root,
    desktop,
    documents,
    downloads,
    adeTrash,
    freshFile,
    executable,
    gitFolder,
    outsidePrefix,
    outsideSecret,
    ...(linkCreated ? { symlink: linkPath } : {}),
  };
}
