// The lava lamp's glass: wax blobs as a 2D metaball field across the glass as the camera sees it, rising and
// falling on the CPU's slow clock, glowing over a liquid lit from the bulb below. Wax pools at the bottom and
// gathers under the cap. The glass's edges, as seen, catch a little more light. Needs no normals (the room's unlit
// meshes are exported without them).
#define BLOBS 6
uniform vec4 uBlobs[BLOBS];
uniform vec3 uWax;
uniform vec3 uLiquid;
uniform float uPower;
uniform vec3 uCentre;
uniform vec2 uAcross;
uniform float uRadius;
uniform float uBottom;
uniform float uHeight;
uniform float uStretch;
varying vec3 vWorld;

void main() {
  float h = clamp((vWorld.y - uBottom) / uHeight, 0.0, 1.0);
  float x = dot(vWorld.xz - uCentre.xz, uAcross) / uRadius;
  // Height in units of the glass's half-width, so blobs read round in a glass taller than it is wide.
  vec2 p = vec2(x, h * uStretch);
  float field = 0.05 / max(h, 0.03) + 0.025 / max(1.0 - h, 0.03);
  for (int i = 0; i < BLOBS; i++) {
    vec2 d = p - vec2(uBlobs[i].x, uBlobs[i].y * uStretch);
    field += uBlobs[i].z * uBlobs[i].z / max(dot(d, d), 1e-4);
  }
  float wax = smoothstep(0.85, 1.15, field);
  float rim = pow(clamp(abs(x), 0.0, 1.0), 4.0);
  vec3 liquid = uLiquid * (0.5 + 0.6 * (1.0 - h));
  vec3 blob = uWax * (0.85 + 0.3 * clamp(field - 1.0, 0.0, 1.0));
  vec3 colour = mix(liquid, blob, wax) * uPower * (1.0 - 0.35 * rim) + vec3(rim * 0.03);
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
