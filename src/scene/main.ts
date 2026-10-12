// The 3D room on `/`: Henry Heffernan's portfolio-website scene (MIT, see NOTICE), ported to current three.js.
import { Application, type RoomHandle, type RoomOptions } from './Application/Application';

export type { RoomHandle, RoomOptions };

/** Builds the room inside `container` and resolves once everything has loaded and START can be shown. */
export async function startRoom(container: HTMLElement, opts: RoomOptions): Promise<RoomHandle> {
  const app = new Application(container, opts);
  try {
    await app.load();
  } catch (error) {
    app.dispose();
    throw error;
  }
  return {
    start: () => app.start(),
    open: (target) => app.open(target),
    setMuted: (muted) => app.setMuted(muted),
    setPaused: (paused) => app.setPaused(paused),
    dispose: () => app.dispose(),
  };
}
