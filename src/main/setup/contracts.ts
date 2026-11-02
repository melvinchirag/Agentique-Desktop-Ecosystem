export const SETUP_IPC = {
  status: 'setup:status', verify: 'setup:verify', save: 'setup:save', progress: 'setup:progress',
  restart: 'setup:restart', demo: 'setup:demo', open: 'setup:open',
} as const;

export interface SetupApi {
  status(): Promise<{ backboard: string | null; elevenLabs: string | null }>;
  verify(key: string): Promise<{ status: 'connected'; balance: number } | { status: 'rejected' | 'unreachable' }>;
  save(backboardKey: string, elevenLabsKey?: string): Promise<{ ok: true } | { ok: false; error: string }>;
  restart(): void;
  demo(): void;
  open(): void;
  onProgress(cb: (message: string) => void): () => void;
}
