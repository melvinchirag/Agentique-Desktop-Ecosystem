import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AccountStatus, BrainStatus } from '../../main/setup/contracts';

/** "Use the AI you already have": find, install and sign in Claude Code, then make it the brain. */
function ClaudeBrain({ busy, setBusy, onDone }: { busy: boolean; setBusy: (on: boolean) => void; onDone: () => void }) {
  const [brain, setBrain] = useState<BrainStatus>();
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const refresh = async () => { try { setBrain(await window.adeSetup.brainStatus()); } catch { setBrain({ installed: false, signedIn: false, active: false }); } };
  useEffect(() => { void refresh(); }, []);
  const install = async () => {
    setBusy(true); setMessage('Installing Claude Code. This takes a minute.');
    try { const r = await window.adeSetup.brainInstall(); setMessage(r.ok ? 'Installed. Now sign in.' : 'The installer did not finish. Try again, or install from claude.ai/download.'); }
    finally { setBusy(false); await refresh(); }
  };
  const signIn = async () => {
    setBusy(true); setMessage('A window opened for the Anthropic sign-in. Finish it there, then press Check again.');
    try { const r = await window.adeSetup.brainSignIn(); if (!r.ok) setMessage('Could not start the sign-in. Is Claude Code installed?'); }
    finally { setBusy(false); }
  };
  const use = async () => {
    setBusy(true); setMessage('');
    try { const r = await window.adeSetup.brainUse(); if (r.ok) { setDone(true); setMessage('Done. Restart ADE and Chip thinks with your Claude Code.'); onDone(); } else setMessage(r.error); }
    finally { setBusy(false); }
  };
  if (!brain) return <p className="status">Looking for Claude Code on this computer...</p>;
  const state = !brain.installed ? 'Not installed' : !brain.signedIn ? `Installed (${brain.version ?? ''}), not signed in` : `Signed in${brain.email ? ` as ${brain.email}` : ''}${brain.active ? '. ADE uses it now' : ''}`;
  return <>
    <p>ADE thinks with the Claude Code you already have. Your plan, your sign-in; ADE stores nothing with anyone else.</p>
    <p className="present">Claude Code: {state}</p>
    {!brain.installed && <button disabled={busy} onClick={install}>Install Claude Code</button>}
    {brain.installed && !brain.signedIn && <button disabled={busy} onClick={signIn}>Sign in</button>}
    {brain.installed && <button className="secondary" disabled={busy} onClick={refresh}>Check again</button>}
    {brain.installed && brain.signedIn && !brain.active && !done && <button disabled={busy} onClick={use}>Use Claude Code</button>}
    {(brain.active || done) && <button onClick={() => window.adeSetup.restart()}>{done ? 'Restart ADE to finish' : 'Continue to ADE'}</button>}
    <p role="status" className="status">{message}</p>
  </>;
}

/** "Use the AI you already have": find, install and sign in Codex, then make it the brain. */
function CodexBrain({ busy, setBusy, onDone }: { busy: boolean; setBusy: (on: boolean) => void; onDone: () => void }) {
  const [brain, setBrain] = useState<BrainStatus>();
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);
  const refresh = async () => { try { setBrain(await window.adeSetup.brainStatus('codex')); } catch { setBrain({ installed: false, signedIn: false, active: false }); } };
  useEffect(() => { void refresh(); }, []);
  const install = async () => {
    setBusy(true); setMessage('Installing Codex. This takes a minute.');
    try { const r = await window.adeSetup.brainInstall('codex'); setMessage(r.ok ? 'Installed. Now sign in.' : 'The installer did not finish. Try again, or install from developers.openai.com/codex/cli.'); }
    finally { setBusy(false); await refresh(); }
  };
  const signIn = async () => {
    setBusy(true); setMessage('A window opened for the OpenAI sign-in. Finish it there, then press Check again.');
    try { const r = await window.adeSetup.brainSignIn('codex'); if (!r.ok) setMessage('Could not start the sign-in. Is Codex installed?'); }
    finally { setBusy(false); }
  };
  const use = async () => {
    setBusy(true); setMessage('');
    try { const r = await window.adeSetup.brainUse('codex'); if (r.ok) { setDone(true); setMessage('Done. Restart ADE and Chip thinks with your Codex.'); onDone(); } else setMessage(r.error); }
    finally { setBusy(false); }
  };
  if (!brain) return <p className="status">Looking for Codex on this computer...</p>;
  const state = !brain.installed ? 'Not installed' : !brain.signedIn ? `Installed (${brain.version ?? ''}), not signed in` : `Signed in${brain.email ? ` as ${brain.email}` : ''}${brain.active ? '. ADE uses it now' : ''}`;
  return <>
    <h3>Codex (ChatGPT plan)</h3>
    <p>ADE thinks with the Codex you already have. Your plan, your sign-in; ADE stores nothing with anyone else.</p>
    <p className="present">Codex: {state}</p>
    {!brain.installed && <button disabled={busy} onClick={install}>Install Codex</button>}
    {brain.installed && !brain.signedIn && <button disabled={busy} onClick={signIn}>Sign in</button>}
    {brain.installed && <button className="secondary" disabled={busy} onClick={refresh}>Check again</button>}
    {brain.installed && brain.signedIn && !brain.active && !done && <button disabled={busy} onClick={use}>Use Codex</button>}
    {(brain.active || done) && <button onClick={() => window.adeSetup.restart()}>{done ? 'Restart ADE to finish' : 'Continue to ADE'}</button>}
    <p role="status" className="status">{message}</p>
  </>;
}

function Setup() {
  const [showBackboard, setShowBackboard] = useState(false);
  const [backboard, setBackboard] = useState('');
  const [elevenLabs, setElevenLabs] = useState('');
  const [existing, setExisting] = useState<{ backboard: string | null; elevenLabs: string | null }>();
  const [verification, setVerification] = useState('');
  const [verified, setVerified] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [account, setAccount] = useState<AccountStatus>();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [accountMessage, setAccountMessage] = useState('');
  useEffect(() => {
    void window.adeSetup.status().then(setExisting);
    void window.adeSetup.accountStatus().then(setAccount).catch(() => setAccount({ enabled: false, signedIn: false }));
    return window.adeSetup.onProgress(message => setProgress(lines => [...lines, message]));
  }, []);
  const sendCode = async () => {
    setBusy(true); setAccountMessage('Sending code...');
    try {
      const result = await window.adeSetup.sendCode(email.trim());
      if (result.ok) { setCodeSent(true); setAccountMessage('Check your email for a 6-digit code.'); }
      else setAccountMessage(result.error);
    } catch { setAccountMessage('Could not reach the sign-in service'); }
    finally { setBusy(false); }
  };
  const verifyCode = async () => {
    setBusy(true); setAccountMessage('Checking code...');
    try {
      const result = await window.adeSetup.verifyCode(email.trim(), code.trim());
      if (result.ok) { setAccount({ enabled: true, signedIn: true, email: email.trim() }); setAccountMessage('Signed in. Continue to Backboard.'); }
      else setAccountMessage(result.error);
    } catch { setAccountMessage('Could not reach the sign-in service'); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setVerified(false); setVerification('Checking Backboard...');
    try {
      const result = await window.adeSetup.verify(backboard);
      if (result.status === 'connected') { setVerified(true); setVerification(`Connected, balance $${result.balance.toFixed(2)}`); }
      else setVerification(result.status === 'rejected' ? 'That key was not accepted' : 'Could not reach Backboard. Try Verify again.');
    } catch { setVerification('Could not reach Backboard. Try Verify again.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setProgress([]);
    try {
      const result = await window.adeSetup.save(backboard, elevenLabs || undefined);
      if (result.ok) { setSaved(true); setVerification('Setup complete. Restart ADE to finish.'); }
      else setVerification(result.error);
    } catch { setVerification('Could not finish setup. Try Save again.'); }
    finally { setBusy(false); }
  };
  return <main>
    <h1>ADE Setup</h1>
    {account?.enabled && !account.signedIn && <section>
      <h2>Step 1 of 2 · Sign in to ADE</h2>
      <label htmlFor="account-email">Email</label>
      <input id="account-email" type="email" autoComplete="email" value={email} disabled={busy || codeSent}
        onChange={event => setEmail(event.target.value)} placeholder="you@example.com" />
      {!codeSent ? <button disabled={busy || !email.trim()} onClick={sendCode}>Send code</button> : <>
        <label htmlFor="account-code">6-digit code</label>
        <input id="account-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
          onChange={event => setCode(event.target.value.replace(/\D/g, ''))} />
        <button disabled={busy || code.length !== 6} onClick={verifyCode}>Verify</button>
        <button className="secondary" disabled={busy} onClick={() => { setCodeSent(false); setCode(''); setAccountMessage(''); }}>Change email</button>
      </>}
      <p role="status" className="status">{accountMessage}</p>
      <p>On our side we keep your email and when you use ADE, nothing else. Your files, mail and memories stay on this computer.</p>
    </section>}
    {account && (!account.enabled || account.signedIn) && <section>
    <h2>{account?.enabled ? 'Step 2 of 2 · ' : ''}Your AI</h2>
    <ClaudeBrain busy={busy} setBusy={setBusy} onDone={() => setShowBackboard(false)} />
    <CodexBrain busy={busy} setBusy={setBusy} onDone={() => setShowBackboard(false)} />
    {!showBackboard && <button className="secondary" disabled={busy} onClick={() => setShowBackboard(true)}>Use Backboard instead</button>}
    </section>}
    {account && (!account.enabled || account.signedIn) && showBackboard && <section>
    <h2>Backboard</h2>
    {existing?.backboard && <button onClick={() => window.adeSetup.restart()}>Continue to ADE</button>}
    <p>Backboard is a cloud AI service. <a href="https://app.backboard.io/" target="_blank" rel="noreferrer">Create an account</a> ($5 free credit for 30 days), copy an API key, and paste it here.</p>
    {existing?.backboard && <p className="present">Current Backboard key: {existing.backboard}</p>}
    <label htmlFor="backboard">Backboard API key</label>
    <input id="backboard" type="password" autoComplete="off" value={backboard} onChange={event => { setBackboard(event.target.value); setVerified(false); setVerification(''); }} placeholder="Paste your key" />
    <button disabled={!backboard.trim() || busy || saved} onClick={verify}>Verify</button>
    <p role="status" className="status">{verification}</p>
    <label htmlFor="elevenlabs">ElevenLabs API key (optional)</label>
    <input id="elevenlabs" type="password" autoComplete="off" value={elevenLabs} onChange={event => setElevenLabs(event.target.value)} placeholder="Paste a key if you have one" />
    {existing?.elevenLabs && <p className="present">Current ElevenLabs key: {existing.elevenLabs}</p>}
    <button disabled={!verified || busy || saved} onClick={save}>Save and create assistants</button>
    {progress.length > 0 && <div className="progress" aria-live="polite">{progress.map((line, i) => <div key={i}>{line}</div>)}</div>}
    {saved && <button onClick={() => window.adeSetup.restart()}>Restart ADE to finish</button>}
    </section>}
    <button className="secondary" disabled={busy} onClick={() => window.adeSetup.demo()}>Try the offline demo instead</button>
  </main>;
}

const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}body{margin:0;background:#141923;color:#eef2f7;font:14px system-ui,sans-serif}main{max-width:460px;margin:0 auto;padding:24px 28px}h1{font-size:25px;margin:0 0 12px}h2{font-size:17px;margin:18px 0 8px}p{line-height:1.45;color:#c8d1df}a{color:#91c7ff}label{display:block;margin:17px 0 7px;font-weight:600}input{width:100%;padding:11px;border:1px solid #68758a;border-radius:6px;background:#202939;color:white;font:inherit}button{display:block;margin:12px 0;padding:10px 14px;border:0;border-radius:6px;background:#7eb8ee;color:#111827;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.45;cursor:default}.secondary{background:transparent;color:#bbd9f6;border:1px solid #657991}.status{min-height:20px}.present{font-size:12px;color:#aab9ca}.progress{max-height:150px;overflow:auto;border:1px solid #3d4a5e;border-radius:6px;padding:8px 10px;color:#c8d1df;font-size:12px}`;
document.head.appendChild(style);
createRoot(document.getElementById('root')!).render(<Setup />);
