export const SETUP_IPC = {
  status: 'setup:status', verify: 'setup:verify', save: 'setup:save', progress: 'setup:progress',
  restart: 'setup:restart', demo: 'setup:demo', open: 'setup:open',
  accountStatus: 'setup:account-status', sendCode: 'setup:send-code',
  verifyCode: 'setup:verify-code', signOut: 'setup:sign-out',
  brainStatus: 'setup:brain-status', brainInstall: 'setup:brain-install', brainSignIn: 'setup:brain-sign-in', brainUse: 'setup:brain-use',
} as const;

export interface AccountStatus { enabled: boolean; signedIn: boolean; email?: string }
/** One CLI brain on this machine (Claude Code, Codex or Gemini CLI), for "use the AI you already have". */
export interface BrainStatus {
  id: 'claude-cli' | 'codex-cli' | 'gemini-cli'; name: string; company: string; note?: string;
  installed: boolean; version?: string; signedIn: boolean; email?: string; active: boolean;
}

export interface SetupApi {
  status(): Promise<{ backboard: string | null; elevenLabs: string | null }>;
  /** All three brains, in the order to show them. */
  brainStatus(): Promise<BrainStatus[]>;
  /** Runs that vendor's official installer; progress lines arrive on onProgress. */
  brainInstall(id: BrainStatus['id']): Promise<{ ok: boolean }>;
  /** Opens that vendor's own sign-in (browser). Check brainStatus() again afterwards. */
  brainSignIn(id: BrainStatus['id']): Promise<{ ok: boolean }>;
  /** Makes that installed brain the one ADE thinks with (ADE_BRAIN=<id>). Restart ADE to finish. */
  brainUse(id: BrainStatus['id']): Promise<{ ok: true } | { ok: false; error: string }>;
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
