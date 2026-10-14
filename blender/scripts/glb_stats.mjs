// Prints what the site pays for in a room glb: bytes, nodes, draw calls and triangles by group, and textures.
//
//   node blender/scripts/glb_stats.mjs [public/room/room.glb] [--nodes] [--json out.json]
//
// Draw calls count every rendered primitive; the invisible hit_* proxies are listed apart, since the site hides them.
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { read as readKtx } from 'ktx-parse';
import { MeshoptDecoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--json') ?? 'public/room/room.glb';
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(file);
const root = doc.getRoot();

const group = (name) => {
  if (name.startsWith('hit_')) return 'hit_ (hidden)';
  const prefix = name.match(/^(env|desk|props|window_view|poster_art|photo_print|sticky_note|nas_led)_/);
  return prefix ? `${prefix[1]}_*` : 'named';
};

const groups = {};
let drawCalls = 0;
let triangles = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const g = group(node.getName());
  groups[g] ??= { nodes: 0, drawCalls: 0, triangles: 0 };
  groups[g].nodes += 1;
  for (const prim of mesh.listPrimitives()) {
    const indices = prim.getIndices();
    const count = indices ? indices.getCount() : prim.getAttribute('POSITION').getCount();
    const tris = Math.floor(count / 3);
    groups[g].drawCalls += 1;
    groups[g].triangles += tris;
    if (!g.startsWith('hit_')) {
      drawCalls += 1;
      triangles += tris;
    }
  }
}

const textures = [];
for (const tex of root.listTextures()) {
  const image = tex.getImage();
  let size = null;
  if (image && tex.getMimeType() === 'image/ktx2') {
    const ktx = readKtx(image);
    size = `${ktx.pixelWidth}x${ktx.pixelHeight}`;
  }
  textures.push({ name: tex.getName() || tex.getURI(), uri: tex.getURI() || null, bytes: image?.byteLength ?? 0, size });
}

const result = {
  file,
  bytes: (await stat(file)).size,
  nodes: root.listNodes().length,
  meshNodes: Object.values(groups).reduce((a, g) => a + g.nodes, 0),
  drawCalls,
  triangles,
  groups,
  textures,
  extensions: root.listExtensionsUsed().map((e) => e.extensionName),
};

console.log(`${result.file}: ${result.bytes.toLocaleString('en-US')} B, ${result.nodes} nodes, ` +
  `${result.drawCalls} draw calls, ${result.triangles.toLocaleString('en-US')} triangles (hit_ proxies excluded)`);
for (const [g, v] of Object.entries(groups).sort()) {
  console.log(`  ${g.padEnd(16)} ${String(v.nodes).padStart(4)} nodes ${String(v.drawCalls).padStart(4)} prims ` +
    `${v.triangles.toLocaleString('en-US').padStart(9)} tris`);
}
for (const t of textures) {
  const where = t.uri ? `by URI ${t.uri} (${(await stat(path.join(path.dirname(file), t.uri))).size.toLocaleString('en-US')} B)` : `${t.bytes.toLocaleString('en-US')} B embedded`;
  console.log(`  texture ${String(t.name).padEnd(20)} ${String(t.size ?? '?').padEnd(10)} ${where}`);
}
if (args.includes('--nodes')) {
  console.log(root.listNodes().map((n) => n.getName()).sort().join('\n'));
}
if (jsonOut) {
  result.nodeNames = root.listNodes().map((n) => n.getName()).sort();
  await writeFile(jsonOut, JSON.stringify(result, null, 2));
}
