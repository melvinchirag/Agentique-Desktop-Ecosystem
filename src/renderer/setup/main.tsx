import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AccountStatus, BrainStatus } from '../../main/setup/contracts';

/** "Use the AI you already have": find, install and sign in Claude Code, Codex or Gemini CLI, then make one the brain. */
function CliBrains({ busy, setBusy, onDone }: { busy: boolean; setBusy: (on: boolean) => void; onDone: () => void }) {
  const [brains, setBrains] = useState<BrainStatus[]>();
  const [message, setMessage] = useState('');
  const [done, setDone] = useState<BrainStatus['id']>();
  const refresh = async () => { try { setBrains(await window.adeSetup.brainStatus()); } catch { setBrains([]); } };
  useEffect(() => { void refresh(); }, []);
  const install = async (b: BrainStatus) => {
    setBusy(true); setMessage(`Installing ${b.name}. This takes a minute.`);
    try { const r = await window.adeSetup.brainInstall(b.id); setMessage(r.ok ? `${b.name} installed. Now sign in.` : `The ${b.name} installer did not finish. Try again, or install it from ${b.company}'s site.`); }
    finally { setBusy(false); await refresh(); }
  };
  const signIn = async (b: BrainStatus) => {
    setBusy(true); setMessage(`A window opened for the ${b.company} sign-in. Finish it there, then press Check again.`);
    try { const r = await window.adeSetup.brainSignIn(b.id); if (!r.ok) setMessage(`Could not start the ${b.name} sign-in.`); }
    finally { setBusy(false); }
  };
  const use = async (b: BrainStatus) => {
    setBusy(true); setMessage(`Asking ${b.name} to answer once, the way ADE will. This can take up to a minute.`);
    try { const r = await window.adeSetup.brainUse(b.id); if (r.ok) { setDone(b.id); setMessage(`${b.name} answered. Restart ADE and Chip thinks with your ${b.name}.`); onDone(); } else setMessage(r.error); }
    finally { setBusy(false); }
  };
  if (!brains) return <p className="status">Looking for Claude Code, Codex and Gemini CLI on this computer...</p>;
  return <>
    <p>ADE thinks with the AI you already pay for, through its own command-line tool. Your plan, your sign-in; ADE stores nothing with anyone else.</p>
    {brains.map((b) => {
      const state = !b.installed ? 'Not installed' : !b.signedIn ? `Installed (${b.version ?? ''}), not signed in` : `Signed in${b.email ? ` as ${b.email}` : ''}${b.active ? '. ADE uses it now' : ''}`;
      return <div key={b.id} className="brain">
        <p className="present"><strong>{b.name}</strong> ({b.company}): {state}{b.note ? <><br /><span>{b.note}</span></> : null}</p>
        {!b.installed && <button className="secondary" disabled={busy} onClick={() => install(b)}>Install {b.name}</button>}
        {b.installed && !b.signedIn && <button disabled={busy} onClick={() => signIn(b)}>Sign in to {b.name}</button>}
        {b.installed && b.signedIn && !b.active && done !== b.id && <button disabled={busy} onClick={() => use(b)}>Use {b.name}</button>}
        {(b.active || done === b.id) && <button onClick={() => window.adeSetup.restart()}>{done === b.id ? 'Restart ADE to finish' : 'Continue to ADE'}</button>}
      </div>;
    })}
    <button className="secondary" disabled={busy} onClick={refresh}>Check again</button>
    <p role="status" className="status">{message}</p>
  </>;
}

function Setup() {
  const [showBackboard, setShowBackboard] = useState(false);
  const [backboard, setBackboard] = useState('');
  const [elevenLabs, setElevenLabs] = useState('');
  const [existing, setExisting] = useState<{ backboard: string | null; elevenLabs: string | null; reason: string | null }>();
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
    {existing?.reason && <p role="alert" className="why">{existing.reason}</p>}
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
    <CliBrains busy={busy} setBusy={setBusy} onDone={() => setShowBackboard(false)} />
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
style.textContent = `*{box-sizing:border-box}body{margin:0;background:#141923;color:#eef2f7;font:14px system-ui,sans-serif}main{max-width:460px;margin:0 auto;padding:24px 28px}h1{font-size:25px;margin:0 0 12px}h2{font-size:17px;margin:18px 0 8px}p{line-height:1.45;color:#c8d1df}a{color:#91c7ff}label{display:block;margin:17px 0 7px;font-weight:600}input{width:100%;padding:11px;border:1px solid #68758a;border-radius:6px;background:#202939;color:white;font:inherit}button{display:block;margin:12px 0;padding:10px 14px;border:0;border-radius:6px;background:#7eb8ee;color:#111827;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.45;cursor:default}.secondary{background:transparent;color:#bbd9f6;border:1px solid #657991}.status{min-height:20px}.present{font-size:12px;color:#aab9ca}.progress{max-height:150px;overflow:auto;border:1px solid #3d4a5e;border-radius:6px;padding:8px 10px;color:#c8d1df;font-size:12px}.why{background:#3a2a1a;border:1px solid #b9823e;border-radius:6px;padding:10px 12px;color:#ffd9a8}`;
document.head.appendChild(style);
createRoot(document.getElementById('root')!).render(<Setup />);
