import type { AdeSettings } from '../../shared/ipc';
import type { SfxPlayer, SpeechQueue } from '../shell/contracts';

/** Apply the independent voice and effects controls on both settings paths. */
export function applyAudioSettings(
  settings: Pick<AdeSettings, 'voiceEnabled' | 'sfxEnabled' | 'ambienceEnabled'>,
  speech: Pick<SpeechQueue, 'setVoiceEnabled'>,
  sfx: Pick<SfxPlayer, 'setEnabled' | 'setAmbienceEnabled'>,
): void {
  speech.setVoiceEnabled(settings.voiceEnabled);
  sfx.setEnabled(settings.sfxEnabled !== false);
  sfx.setAmbienceEnabled(settings.ambienceEnabled === true);
}
