import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function Setup() {
  const [backboard, setBackboard] = useState('');
  const [elevenLabs, setElevenLabs] = useState('');
  const [existing, setExisting] = useState<{ backboard: string | null; elevenLabs: string | null }>();
  const [verification, setVerification] = useState('');
  const [verified, setVerified] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void window.adeSetup.status().then(setExisting);
    return window.adeSetup.onProgress(message => setProgress(lines => [...lines, message]));
  }, []);
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
    <p>ADE needs a Backboard account to think. <a href="https://app.backboard.io/" target="_blank" rel="noreferrer">Create one</a> ($5 free credit for 30 days), copy an API key, and paste it here.</p>
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
    <button className="secondary" disabled={busy} onClick={() => window.adeSetup.demo()}>Try the offline demo instead</button>
  </main>;
}

const style = document.createElement('style');
style.textContent = `*{box-sizing:border-box}body{margin:0;background:#141923;color:#eef2f7;font:14px system-ui,sans-serif}main{max-width:460px;margin:0 auto;padding:24px 28px}h1{font-size:25px;margin:0 0 12px}p{line-height:1.45;color:#c8d1df}a{color:#91c7ff}label{display:block;margin:17px 0 7px;font-weight:600}input{width:100%;padding:11px;border:1px solid #68758a;border-radius:6px;background:#202939;color:white;font:inherit}button{display:block;margin:12px 0;padding:10px 14px;border:0;border-radius:6px;background:#7eb8ee;color:#111827;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.45;cursor:default}.secondary{background:transparent;color:#bbd9f6;border:1px solid #657991}.status{min-height:20px}.present{font-size:12px;color:#aab9ca}.progress{max-height:150px;overflow:auto;border:1px solid #3d4a5e;border-radius:6px;padding:8px 10px;color:#c8d1df;font-size:12px}`;
document.head.appendChild(style);
createRoot(document.getElementById('root')!).render(<Setup />);
