export const SETUP_IPC = {
  status: 'setup:status', verify: 'setup:verify', save: 'setup:save', progress: 'setup:progress',
  restart: 'setup:restart', demo: 'setup:demo', open: 'setup:open',
  accountStatus: 'setup:account-status', sendCode: 'setup:send-code',
  verifyCode: 'setup:verify-code', signOut: 'setup:sign-out',
} as const;

export interface AccountStatus { enabled: boolean; signedIn: boolean; email?: string }

export interface SetupApi {
  status(): Promise<{ backboard: string | null; elevenLabs: string | null }>;
  verify(key: string): Promise<{ status: 'connected'; balance: number } | { status: 'rejected' | 'unreachable' }>;
  save(backboardKey: string, elevenLabsKey?: string): Promise<{ ok: true } | { ok: false; error: string }>;
  restart(): void;
  demo(): void;
  open(): void;
  accountStatus(): Promise<AccountStatus>;
  sendCode(email: string): Promise<{ ok: true } | { ok: false; error: string }>;
  verifyCode(email: string, code: string): Promise<{ ok: true } | { ok: false; error: string }>;
  signOut(): Promise<void>;
  onProgress(cb: (message: string) => void): () => void;
}
