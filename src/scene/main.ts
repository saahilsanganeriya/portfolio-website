// The 3D room on every page: Henry Heffernan's portfolio-website scene (MIT, see NOTICE), ported to current three.js.
import { Application, type RoomHandle, type RoomOptions, type StartOptions } from './Application/Application';

export type { RoomHandle, RoomOptions, StartOptions };

/** Builds the room inside `container` and resolves once everything has loaded and the room can be entered. */
export async function startRoom(container: HTMLElement, opts: RoomOptions): Promise<RoomHandle> {
  const app = new Application(container, opts);
  try {
    await app.load();
  } catch (error) {
    app.dispose();
    throw error;
  }
  return {
    start: (options) => app.start(options),
    openWindow: (target, options) => app.openWindow(target, options),
    skipIntro: () => app.skipIntro(),
    unlockAudio: () => app.unlockAudio(),
    setMuted: (muted) => app.setMuted(muted),
    setPaused: (paused) => app.setPaused(paused),
    dispose: () => app.dispose(),
  };
}
