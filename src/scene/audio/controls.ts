import type { AudioHandle } from './RoomAudio';
import { readSettings, writeSettings, type SoundSettings } from './state';

export interface SoundControls {
  /** Hands the controls the room's sound once it has loaded; they apply the remembered volume and mute to it. */
  attach(audio: AudioHandle): void;
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * The Sound toggle (pressed = sound on) and the volume slider, both remembered across visits. A remembered mute holds:
 * the visitor's first click or key no longer starts the sound, only the toggle does. Until the sound first starts, the
 * toggle is marked `data-hint` (it glows gently) so a visitor knows the room has sound; one who turned it off is not
 * nagged.
 */
export function mountSoundControls(toggle: HTMLButtonElement, slider: HTMLInputElement, store: Storage | null = storage()): SoundControls {
  const settings: SoundSettings = readSettings(store);
  let audio: AudioHandle | null = null;
  slider.value = String(Math.round(settings.volume * 100));

  const show = () => {
    toggle.setAttribute('aria-pressed', String(Boolean(audio?.unlocked) && !settings.muted));
    toggle.toggleAttribute('data-hint', !audio?.unlocked && !settings.muted);
    slider.setAttribute('aria-valuetext', `${slider.value} percent`);
  };

  toggle.addEventListener('click', () => {
    if (!audio) return;
    settings.muted = audio.unlocked && !settings.muted;
    audio.setMuted(settings.muted);
    // The toggle's own press is a gesture, so it may start the sound the first time.
    if (!settings.muted) audio.unlock();
    writeSettings(store, settings);
    show();
  });

  slider.addEventListener('input', () => {
    settings.volume = Number(slider.value) / 100;
    audio?.setVolume(settings.volume);
    writeSettings(store, settings);
    show();
  });

  show();
  return {
    attach(handle) {
      audio = handle;
      handle.setVolume(settings.volume);
      handle.setMuted(settings.muted);
      handle.subscribe(show);
      show();
    },
  };
}
