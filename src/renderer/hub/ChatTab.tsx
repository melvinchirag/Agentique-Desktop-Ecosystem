import React, { useEffect, useRef, useState } from 'react';
import type { AdeApi } from '../../shared/ipc';
import type { AdeShellApi } from '../../main/shell/contracts';
import type { HubStoreHook } from '../shell/contracts';
import { AGENTS } from '../../shared/config';
import { HubMicRecorder } from './mic';

interface ChatTabProps {
  store: HubStoreHook;
  api: AdeApi;
  shell: AdeShellApi;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const ChatTab: React.FC<ChatTabProps> = ({ store, api, shell, inputRef }) => {
  const transcript = store((state) => state.transcript);
  const [text, setText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const micRecorderRef = useRef<HubMicRecorder | null>(null);

  if (!micRecorderRef.current) {
    micRecorderRef.current = new HubMicRecorder();
  }

  // Scroll to bottom when transcript changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;

    setText('');
    await api.sendMessage(message, 'text');
    shell.blurHub();
  };

  const handlePointerDownMic = async () => {
    try {
      setIsRecording(true);
      await micRecorderRef.current?.start(30000, async (result) => {
        setIsRecording(false);
        if (result && result.audio.byteLength > 0) {
          await api.sendVoice(result.audio, result.mime);
        }
      });
    } catch {
      setIsRecording(false);
    }
  };

  const handlePointerUpMic = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    try {
      const result = await micRecorderRef.current?.stop();
      if (result && result.audio.byteLength > 0) {
        await api.sendVoice(result.audio, result.mime);
      }
    } catch {
      // Ignore
    }
  };

  return (
    <div className="hub-chat-container">
      {/* Transcript */}
      <div className="hub-transcript" ref={scrollRef} aria-label="Chat transcript">
        {transcript.map((line) => {
          const isUser = line.from === 'user' || line.kind === 'user';
          const agentProfile = line.from !== 'user' ? AGENTS[line.from] : undefined;
          const speakerName = isUser
            ? 'You'
            : agentProfile?.displayName ?? line.from;

          return (
            <div
              key={line.id}
              className={`hub-transcript-line ${line.kind}`}
              data-testid={`transcript-line-${line.id}`}
            >
              {!isUser && line.kind !== 'system' && (
                <div
                  className="hub-speaker-name"
                  style={{ color: agentProfile?.color ?? 'var(--hub-accent)' }}
                >
                  {speakerName}
                </div>
              )}
              <div>{line.text}</div>
            </div>
          );
        })}
      </div>

      {/* Input form */}
      <form className="hub-chat-input-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="hub-chat-input"
          placeholder="Ask Chip anything..."
          aria-label="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {/* Hold to talk mic button */}
        <button
          type="button"
          className={`hub-mic-btn ${isRecording ? 'recording' : ''}`}
          onPointerDown={handlePointerDownMic}
          onPointerUp={handlePointerUpMic}
          onPointerCancel={handlePointerUpMic}
          onPointerLeave={handlePointerUpMic}
          aria-label="Hold to talk"
          title="Hold to talk (up to 30s)"
        >
          🎤
        </button>

        <button type="submit" className="hub-send-btn" aria-label="Send message">
          Send
        </button>
      </form>
    </div>
  );
};
