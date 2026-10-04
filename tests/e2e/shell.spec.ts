import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const shots = join(process.cwd(), 'tests/e2e/screenshots/latest');
const sequence = (events: any[], wanted: Array<[string, Record<string, unknown>?]>) => {
  let next = 0;
  for (const event of events) {
    const [type, fields] = wanted[next] ?? [];
    if (event.type === type && Object.entries(fields ?? {}).every(([key, value]) => event[key] === value)) next++;
  }
  return next === wanted.length;
};

let app: ElectronApplication;
let hub: Page;
let overlay: Page;
let step = 0;

async function snap(label: string) {
  const name = `${String(++step).padStart(2, '0')}-${label}`;
  await hub.screenshot({ path: join(shots, `${name}-hub.png`) });
  await overlay.screenshot({ path: join(shots, `${name}-overlay.png`) });
}

async function events(taskId: string): Promise<any[]> {
  return hub.evaluate(id => (window as any).ade.getTaskEvents(id), taskId);
}

async function send(message: string): Promise<string> {
  await hub.getByRole('textbox', { name: 'Message' }).fill(message);
  await hub.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(async () => {
    const all = await hub.evaluate(() => (window as any).ade.getTimeline(0, Date.now() + 1000));
    return all.findLast((event: any) => event.type === 'user.message' && event.text === message)?.taskId;
  }).toBeTruthy();
  const all = await hub.evaluate(() => (window as any).ade.getTimeline(0, Date.now() + 1000));
  return all.findLast((event: any) => event.type === 'user.message' && event.text === message).taskId;
}

async function ordered(taskId: string, wanted: Array<[string, Record<string, unknown>?]>) {
  await expect.poll(async () => sequence(await events(taskId), wanted), { timeout: 15_000 }).toBe(true);
}

function winStyle(handle: string): number {
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int n); }'; [W]::GetWindowLongPtr([IntPtr]::new(${BigInt(handle)}), -20).ToInt64()`;
  return Number(execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim());
}

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  app = await _electron.launch({ args: ['out/main/index.js', '--demo', '--no-gpu'], timeout: 30_000 });
  await expect.poll(async () => (await app.windows()).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const windows = await app.windows();
  hub = windows[0];
  for (const page of windows) {
    const title = await page.title();
    if (title === 'ADE Hub') hub = page;
    if (title === 'ADE Overlay') overlay = page;
  }
  if (!overlay) overlay = windows.find(page => page !== hub)!;
  await expect(hub.getByTestId('hub-root')).toBeVisible();
  const onboarding = hub.getByRole('button', { name: 'Finish onboarding' });
  if (await onboarding.isVisible()) await onboarding.click();
  await expect(hub.getByRole('textbox', { name: 'Message' })).toBeVisible();
});

test.afterAll(async () => { await app?.close(); });

test('Windows: geometry, transparency, focus, taskbar and character hit region', async () => {
  const state = await app.evaluate(async ({ BrowserWindow, screen }) => {
    const windows = BrowserWindow.getAllWindows();
    const over = windows.find(w => w.webContents.getURL().includes('overlay.html'))!;
    const h = windows.find(w => w.webContents.getURL().includes('hub.html'))!;
    const corner = await over.capturePage({ x: 0, y: 0, width: 1, height: 1 });
    return { bounds: over.getBounds(), workArea: screen.getPrimaryDisplay().workArea,
      transparentColor: over.getBackgroundColor(), overlayFocusable: over.isFocusable(),
      hubFocusable: h.isFocusable(), overlayTop: over.isAlwaysOnTop(), hubTop: h.isAlwaysOnTop(),
      overlayHandle: over.getNativeWindowHandle().readBigInt64LE().toString(),
      hubHandle: h.getNativeWindowHandle().readBigInt64LE().toString(),
      contentBounds: over.getContentBounds(), cornerPixel: [...corner.toBitmap().subarray(0, 4)] };
  });
  expect(state.bounds).toEqual(state.workArea);
  expect(state.contentBounds).toEqual(state.bounds); // frameless
  expect(state.transparentColor.toLowerCase()).toMatch(/#(?:00000000|000000)/);
  expect(state.cornerPixel[3]).toBe(0);
  expect(state.overlayFocusable).toBe(false);
  expect(state.hubFocusable).toBe(true);
  expect(state.overlayTop && state.hubTop).toBe(true);
  const overlayStyle = winStyle(state.overlayHandle);
  const hubStyle = winStyle(state.hubHandle);
  expect(overlayStyle & 0x80 || !(overlayStyle & 0x40000)).toBeTruthy(); // WS_EX_TOOLWINDOW or no WS_EX_APPWINDOW
  expect(hubStyle & 0x80 || !(hubStyle & 0x40000)).toBeTruthy();
  await expect.poll(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('overlay.html'))?.isFocused()))).toBe(false);
  await app.evaluate(({ BrowserWindow }) => {
    const h = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('hub.html'))!;
    (globalThis as any).__hubBlurCalls = 0;
    const original = h.blur.bind(h);
    h.blur = (() => { (globalThis as any).__hubBlurCalls++; original(); }) as typeof h.blur;
  });
  await hub.getByRole('textbox', { name: 'Message' }).click();
  await expect(hub.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await hub.keyboard.press('Escape');
  await expect.poll(() => app.evaluate(() => (globalThis as any).__hubBlurCalls)).toBe(1);

  // Observe the actual main-process mouse-ignore calls caused by renderer hit testing.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().includes('overlay.html'))!;
    (globalThis as any).__ignoreTransitions = [];
    const original = w.setIgnoreMouseEvents.bind(w);
    w.setIgnoreMouseEvents = ((ignore: boolean, options?: Electron.IgnoreMouseEventsOptions) => {
      (globalThis as any).__ignoreTransitions.push(ignore);
      original(ignore, options);
    }) as typeof w.setIgnoreMouseEvents;
  });
  const size = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  // Chip is at 38% of the work area; scan its projected box from bottom up.
  for (let y = size.height - 10; y > size.height - 150; y -= 10) {
    await overlay.evaluate(point => window.dispatchEvent(new MouseEvent('mousemove', { clientX: point.x, clientY: point.y })), { x: Math.round(size.width * .38), y });
    const hit = await app.evaluate(() => (globalThis as any).__ignoreTransitions.includes(false));
    if (hit) break;
  }
  await expect.poll(() => app.evaluate(() => (globalThis as any).__ignoreTransitions.includes(false))).toBe(true);
  await overlay.evaluate(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 })));
  await expect.poll(() => app.evaluate(() => (globalThis as any).__ignoreTransitions.at(-1))).toBe(true);
  await snap('windows-hit-testing');
});

test('email digest: ordered handoff, work, artifact, report and summary', async () => {
  const id = await send('email');
  await ordered(id, [['user.message'], ['agent.say', { agentId: 'chipmunk' }], ['agent.handoff', { to: 'workspace' }], ['job.update', { state: 'running' }], ['artifact', { title: 'Inbox digest' }], ['job.update', { state: 'done' }], ['agent.say', { agentId: 'workspace' }], ['agent.say', { agentId: 'chipmunk' }]]);
  expect((await events(id)).filter(event => event.type === 'user.message')).toHaveLength(1);
  await expect(hub.getByText('Inbox digest')).toBeVisible();
  await expect(hub.getByText(/two priorities/i)).toBeVisible();
  await snap('email-digest');
});

test('pizza: parallel Scout and Pixel jobs, tray items and return', async () => {
  const id = await send('pizza');
  await ordered(id, [['agent.handoff', { to: 'eagle' }], ['agent.status', { agentId: 'eagle', status: 'away' }], ['artifact', { title: 'Pizza nearby' }], ['job.update', { to: 'eagle', state: 'done' }], ['agent.return', { agentId: 'eagle' }], ['agent.status', { agentId: 'eagle', status: 'idle' }], ['artifact', { title: 'Pizza invitation' }], ['job.update', { to: 'workspace', state: 'done' }]]);
  await expect(hub.getByTestId('agent-row-workspace')).not.toContainText('Pizza invite');
  await expect(hub.getByText('Pizza nearby')).toBeVisible();
  await expect(hub.getByText('Pizza invitation')).toBeVisible();
  await expect(hub.getByRole('button', { name: /Open in Gmail: Pizza invitation/ })).toBeVisible();
  await snap('pizza-parallel');
});

test('ugh: angry mood, contagion and relief', async () => {
  const id = await send('ugh');
  await ordered(id, [['user.mood', { mood: 'angry' }], ['agent.mood', { agentId: 'chipmunk', mood: 'scared' }], ['agent.mood', { agentId: 'wolf', mood: 'protective' }], ['agent.mood', { agentId: 'workspace', mood: 'nervous' }], ['user.mood', { mood: 'happy' }], ['agent.mood', { agentId: 'chipmunk', mood: 'relieved' }]]);
  await expect(hub.getByText('happy', { exact: true })).toBeVisible();
  await expect(hub.getByText(/that sounds exhausting/i)).toBeVisible();
  await snap('angry-relief');
});

test('send it: Warden denies and warns', async () => {
  const id = await send('send it');
  await ordered(id, [['tool.request', { tool: 'gmail_send' }], ['wolf.verdict', { verdict: 'deny' }], ['agent.mood', { agentId: 'wolf', mood: 'protective' }], ['agent.say', { agentId: 'wolf' }]]);
  await expect(hub.getByText(/I stopped that/i)).toBeVisible();
  await expect(overlay.locator('.overlay-bubble[data-agent="wolf"]')).toContainText(/Blocked|I stopped/, { timeout: 20_000 });
  await snap('warden-block');
});

test('Audit replay runs the recorded Warden task at 2×', async () => {
  const id = await send('send it');
  await ordered(id, [['tool.request', { tool: 'gmail_send' }], ['wolf.verdict', { verdict: 'deny' }]]);
  await hub.getByRole('tab', { name: 'Audit' }).click();
  await hub.getByRole('button', { name: `Replay task ${id}` }).click();
  await expect(overlay.locator('.overlay-replay')).toBeVisible();
  await snap('replay');
  await expect(overlay.locator('.overlay-replay')).toHaveCount(0, { timeout: 10_000 });
  await hub.getByRole('tab', { name: 'Chat' }).click();
});

for (const allow of [true, false]) {
  test(`trash: ApprovalCard ${allow ? 'Allow' : 'Deny'} resolves`, async () => {
    const id = await send('trash');
    await ordered(id, [['tool.request', { tool: 'fs_trash' }], ['wolf.verdict', { verdict: 'ask' }], ['approval.request']]);
    await expect(overlay.getByRole('region', { name: 'Warden approval' })).toBeVisible({ timeout: 15_000 });
    await expect(hub.getByTestId('agent-row-beaver')).toContainText('Approval');
    await snap(`approval-${allow ? 'allow' : 'deny'}-card`);
    await overlay.getByRole('button', { name: allow ? 'Allow' : 'Deny' }).click();
    await ordered(id, [['approval.request'], ['approval.resolve', { approved: allow }], ['tool.result', { ok: allow }]]);
    await expect(overlay.getByRole('region', { name: 'Warden approval' })).toHaveCount(0);
    if (allow) await expect(hub.getByText('Cleanup plan')).toBeVisible();
    else await expect(hub.getByText(/No changes made/)).toBeVisible();
    await snap(`approval-${allow ? 'allow' : 'deny'}-resolved`);
  });
}

test('report: ant-carried plan and report artifact', async () => {
  const id = await send('report');
  await ordered(id, [['agent.handoff', { to: 'ants' }], ['artifact', { title: 'Three-step report plan' }], ['agent.handoff', { to: 'beaver', via: 'ants' }], ['agent.handoff', { to: 'eagle', via: 'ants' }], ['agent.handoff', { to: 'workspace', via: 'ants' }], ['job.update', { requestedBy: 'workspace', state: 'queued' }], ['job.update', { requestedBy: 'workspace', state: 'running' }], ['agent.status', { agentId: 'eagle', status: 'idle' }], ['artifact', { title: 'Report draft' }], ['job.update', { to: 'workspace', state: 'done' }]]);
  await expect(hub.getByText('Three-step report plan')).toBeVisible();
  await expect(hub.getByText('Report draft', { exact: true })).toBeVisible();
  await expect(hub.getByTestId('agent-row-workspace')).not.toContainText('Quick task');
  await snap('ant-report');
});

test('sleep: demo timer, dock, then wake from Agents menu', async () => {
  const before = await hub.evaluate(() => (window as any).adeShell.getLayout());
  await app.evaluate(({ BrowserWindow }) => {
    const h = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('hub.html'))!;
    const { x, y } = h.getBounds();
    h.setPosition(x - 80, y + 20);
  });
  await expect.poll(async () => (await hub.evaluate(() => (window as any).adeShell.getLayout())).hubBounds.x).toBeLessThan(before.hubBounds.x);
  await hub.evaluate(() => (window as any).ade.setSettings({ timers: { sleepAfterSec: 1, dockAfterSec: 2 } }));
  const id = await send('sleep');
  await ordered(id, [['agent.presence', { agentId: 'beaver', presence: 'sleeping' }]]);
  await expect(hub.getByTestId('agent-row-beaver')).toContainText('sleeping');
  await snap('sleep');
  await ordered(id, [['agent.presence', { presence: 'sleeping' }], ['agent.presence', { presence: 'docked' }]]);
  await expect(hub.getByTestId('agent-row-beaver')).toContainText('docked');
  await hub.getByRole('button', { name: 'Agents dropdown' }).click();
  await expect(hub.getByRole('button', { name: 'Wake Archie' })).toBeVisible();
  await snap('docked');
  await hub.getByRole('button', { name: 'Wake Archie' }).click();
  await expect(hub.getByTestId('agent-row-beaver')).toContainText('active');
  await snap('woken');
});

test('nudge: demo IPC fires knock and notification', async () => {
  const before = await hub.evaluate(() => (window as any).ade.getTimeline(0, Date.now() + 1000));
  await hub.evaluate(() => (window as any).ade.demoFireNudge());
  await expect.poll(async () => (await hub.evaluate(() => (window as any).ade.getTimeline(0, Date.now() + 1000))).some((event: any) => event.type === 'nudge.fire' && !before.some((old: any) => old.id === event.id))).toBe(true);
  await expect(hub.getByRole('button', { name: 'Nudge notification' })).toBeVisible();
  await expect(hub.getByText('How did the midterm go?', { exact: true })).toBeVisible();
  await expect(overlay.locator('.overlay-bubble[data-agent="chipmunk"]')).toContainText(/Midterm|How did/, { timeout: 20_000 });
  await snap('nudge');
});

test('remember: recall event, sparkle and transcript memory', async () => {
  const id = await send('remember');
  await ordered(id, [['agent.recall', { agentId: 'chipmunk' }], ['agent.say', { agentId: 'chipmunk' }]]);
  await expect(hub.getByText(/Remembered: Prefers study blocks/)).toBeVisible();
  await expect(overlay.getByLabel('Recall')).toBeVisible();
  await snap('recall');
});
