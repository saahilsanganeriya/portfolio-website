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
 * The Sound toggle and the volume slider, both remembered across visits. The toggle is pressed only while the sound
 * really plays (the browser let it run, and it is not muted); its title says which of on, off or waiting it is. A
 * remembered mute holds: no autoplay, and the visitor's first click or key no longer starts the sound, only the toggle
 * does. While the sound waits for the browser's permission the toggle is marked `data-hint` (it glows gently) so a
 * visitor knows the room has sound; one who turned it off is not nagged.
 */
export function mountSoundControls(toggle: HTMLButtonElement, slider: HTMLInputElement, store: Storage | null = storage()): SoundControls {
  const settings: SoundSettings = readSettings(store);
  let audio: AudioHandle | null = null;
  slider.value = String(Math.round(settings.volume * 100));

  const show = () => {
    const playing = Boolean(audio?.unlocked) && !settings.muted;
    toggle.setAttribute('aria-pressed', String(playing));
    toggle.toggleAttribute('data-hint', !audio?.unlocked && !settings.muted);
    toggle.title = playing ? 'Sound is on' : settings.muted ? 'Sound is off' : 'Sound starts with your first click or key press';
    slider.setAttribute('aria-valuetext', `${slider.value} percent`);
  };

  toggle.addEventListener('click', () => {
    if (!audio) return;
    // Pressed while it plays, it turns the sound off; otherwise on (its own press is a gesture, so the browser allows it).
    settings.muted = audio.unlocked && !settings.muted;
    audio.setMuted(settings.muted);
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
