// Builds the site (optional) and serves the production output with `astro preview` on a free local port.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

export async function serveBuild({ build = true } = {}) {
  if (build) {
    const result = spawnSync('npx', ['astro', 'build'], { encoding: 'utf8' });
    if (result.status !== 0) {
      process.stderr.write(result.stdout + result.stderr);
      throw new Error('astro build failed');
    }
  }
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  // Its own process group, so closing it also stops the server npx starts.
  const child = spawn('npx', ['astro', 'preview', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore',
    detached: true,
  });
  const close = async () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  };
  for (let waited = 0; waited < 60_000; waited += 250) {
    try {
      if ((await fetch(url)).ok) return { url, close };
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  await close();
  throw new Error(`astro preview did not answer on ${url} within 60 s`);
}
