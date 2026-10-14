// The 3D room on every page: Henry Heffernan's portfolio-website scene (MIT, see NOTICE), ported to current three.js.
import { Application, type RoomHandle, type RoomOptions, type RoomView, type StartOptions } from './Application/Application';
import type { StationName } from './Application/RoomModel';

export type { RoomHandle, RoomOptions, RoomView, StartOptions, StationName };

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
    fly: (station) => app.fly(station),
    visit: (station, onDone) => app.visit(station, onDone),
    has: (station): station is StationName => app.has(station),
    view: () => app.view(),
    skipIntro: () => app.skipIntro(),
    audio: app.audio,
    setPaused: (paused) => app.setPaused(paused),
    measureFps: (ms) => app.measureFps(ms),
    dispose: () => app.dispose(),
  };
}
