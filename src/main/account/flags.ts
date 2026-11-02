import { ACCOUNT } from './account.config';

export function accountEnabled(config = ACCOUNT, env = process.env): boolean {
  return env.ADE_ACCOUNT !== 'off' && !!config.url.trim() && !!config.anonKey.trim();
}
