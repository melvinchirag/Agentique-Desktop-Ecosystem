import { describe, expect, it, vi } from 'vitest';
import type { DriveFile, GoogleApi } from '../../src/main/connectors/google/api';
import { createDriveTools } from '../../src/main/agents/workspace/driveTools';
import type { InjectionScreen } from '../../src/main/runtime/types';
import type { ToolContext } from '../../src/shared/tools';

const file: DriveFile = { id: 'f1', name: 'report.txt', mimeType: 'text/plain', kind: 'other', size: 20 };
const google = {
  drive: {
    search: vi.fn(async () => [file]), getFile: vi.fn(async () => file), exportText: vi.fn(async () => 'CANARY-DRIVE text'),
    download: vi.fn(async () => new TextEncoder().encode('CANARY-DRIVE text')),
  },
} as unknown as GoogleApi;
const screen: InjectionScreen = { screen: async (text, source) => ({ flagged: text.includes('CANARY'), score: 0, reasons: [], wrapped: `<untrusted source="${source.name}" flagged="${text.includes('CANARY')}">${text}</untrusted>` }) };
const context = { agentId: 'workspace', taskId: 't', jobId: 'j', sessionId: 's', threadId: 'job-thread', signal: new AbortController().signal, emit: vi.fn() } as unknown as ToolContext;
const tempCalled = vi.fn();
const temp = { withTempFile: async <T>(_name: string, _bytes: Uint8Array, use: (path: string) => Promise<T>): Promise<T> => { tempCalled(); return use('C:/ADE/temp/drive.txt'); } };
const documents = { uploadToThread: vi.fn(async (threadId: string, path: string) => ({ documentId: `${threadId}:${path}` })), waitIndexed: vi.fn(async (): Promise<{ status: 'indexed' | 'error'; chunks: number }> => ({ status: 'indexed', chunks: 1 })) };

describe('Pixel Drive tools', () => {
  it('screens names and contents and only exports safe text formats', async () => {
    const [search, read] = createDriveTools({ google: () => google, screen });
    const found = await search.execute({ text: 'report', max_results: 90 }, context) as any;
    expect(google.drive.search).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 25 }));
    expect(found.files[0].name).toContain('<untrusted');
    const result = await read.execute({ drive_file_id: 'f1', max_chars: 4000 }, context) as any;
    expect(result.content).toContain('CANARY-DRIVE');
    (google.drive.getFile as any).mockResolvedValueOnce({ ...file, mimeType: 'application/octet-stream' });
    expect((await read.execute({ drive_file_id: 'f1' }, context) as any).error).toBe('UNSUPPORTED_TYPE');
    (google.drive.getFile as any).mockResolvedValueOnce({ ...file, size: 21 * 1024 * 1024 });
    expect((await read.execute({ drive_file_id: 'f1' }, context) as any).error).toBe('TOO_LARGE');
  });

  it('uploads supported content only to the current job thread and uses temp cleanup wrapper', async () => {
    const [, , ask] = createDriveTools({ google: () => google, screen, documents, tempFiles: temp });
    const result = await ask.execute({ drive_file_id: 'f1' }, context) as any;
    expect(result.thread_id).toBe('job-thread');
    expect(documents.uploadToThread).toHaveBeenCalledWith('job-thread', 'C:/ADE/temp/drive.txt');
    expect(tempCalled).toHaveBeenCalledOnce();
    (google.drive.getFile as any).mockResolvedValueOnce({ ...file, name: 'tool.exe', mimeType: 'application/x-msdownload' });
    expect((await ask.execute({ drive_file_id: 'f1' }, context) as any).error).toBe('UNSUPPORTED_TYPE');
    documents.waitIndexed.mockResolvedValueOnce({ status: 'error', chunks: 0 });
    await expect(ask.execute({ drive_file_id: 'f1' }, context)).rejects.toThrow('INDEXING_TIMEOUT');
  });
});
