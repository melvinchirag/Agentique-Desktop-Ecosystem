import { useState } from 'react';
import { AGENTS } from '../../shared/config';
import type { HubAppComponent } from '../shell/contracts';

export const HubApp: HubAppComponent = ({ store, api }) => {
  const agents = store(state => state.agents);
  const transcript = store(state => state.transcript);
  const [text, setText] = useState('');
  return <main style={{ fontFamily: 'sans-serif', padding: 12 }}>
    <h1>ADE Hub</h1>
    <section aria-label="Agents">{Object.values(agents).map(row =>
      <div key={row.id}>{AGENTS[row.id].displayName}: {row.presence} · {row.status}</div>)}</section>
    <section aria-label="Transcript">{transcript.map(line =>
      <p key={line.id}><strong>{line.from}:</strong> {line.text}</p>)}</section>
    <form onSubmit={event => {
      event.preventDefault();
      const message = text.trim();
      if (message) { void api.sendMessage(message, 'text'); setText(''); }
    }}><input aria-label="Message" value={text} onChange={event => setText(event.target.value)} />
      <button type="submit">Send</button></form>
  </main>;
};
