import type { PulseResponse, WardenAuditRow } from '../../renderer/hub/responses';
import type { BiomeEventInput } from '../runtime/types';
export interface DemoScript { name: string; keywords: string[]; steps: { atMs: number; event: BiomeEventInput }[]; approval?: { callId: string; approved: readonly { atMs: number; event: BiomeEventInput }[]; denied: readonly { atMs: number; event: BiomeEventInput }[] } }
export type FakePulse = PulseResponse;
export type FakeAuditRow = WardenAuditRow;
