// The projector's picture, on the roller screen or the wall. The first room baked this patch of wall as lit by the
// projector's open gate (the bright rectangle, its second UV set into the atlas); with film in the gate only the
// picture's light lands, so the wall shows its other light (`uAmbient` of the bake, on the wall's own colour `uWall`)
// plus the gate's light times the picture. A roller screen is baked with the lamp off, so the picture adds to it. Per film frame the
// picture weaves in the gate and the lamp flickers; grain runs over it and the light falls off toward the corners. A
// program change rolls the film: frame A slides up out of the gate, frame B follows with the frame line between them.
// `uStill` (reduced motion) holds the weave, flicker and grain still.
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uBake;
uniform float uUseBake;
uniform float uMixB;
uniform float uRoll;
uniform float uColour;
uniform float uFrame;
uniform float uShown;
uniform float uAmbient;
uniform vec3 uWall;
uniform float uStill;
uniform vec2 uFlip;
uniform float uGateBaked;
uniform vec3 uLampTint;
uniform vec3 uRoomTint;
uniform vec3 uLampPos;
uniform float uLampRange;
varying vec2 vUv;
varying vec2 vBakeUv;
varying vec3 vWorld;

const float FRAME_LINE = 0.08;

// Dave Hoskins' hash12 (Hash without Sine, MIT).
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 frameAt(vec2 uv) {
  if (uRoll <= 0.0) return mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, uMixB);
  float ya = uv.y + uRoll * (1.0 + FRAME_LINE);
  float yb = ya - 1.0 - FRAME_LINE;
  if (ya <= 1.0) return texture2D(uA, vec2(uv.x, ya)).rgb;
  if (yb >= 0.0) return texture2D(uB, vec2(uv.x, yb)).rgb;
  return vec3(0.0);
}

void main() {
  vec3 bake = uUseBake > 0.5 ? texture2D(uBake, vBakeUv).rgb : vec3(0.9);
  float moving = 1.0 - uStill;
  vec2 weave = (vec2(hash(vec2(uFrame, 1.7)), hash(vec2(uFrame, 9.1))) - 0.5) * vec2(0.004, 0.007) * moving;
  // The picture reads left to right and top down whichever way the wall's UVs run.
  vec2 pictureUv = mix(vUv, 1.0 - vUv, uFlip);
  vec2 uv = pictureUv + weave;
  vec3 rgb = frameAt(uv);
  vec3 picture = mix(vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722))), rgb, uColour);

  float flicker = 1.0 - (0.07 * hash(vec2(uFrame, 4.3)) - 0.3 * sin(uRoll * 3.14159)) * moving;
  vec2 centred = pictureUv - 0.5;
  float hotspot = 1.0 - 0.45 * dot(centred, centred) * 2.0;
  vec2 edge = min(uv, 1.0 - uv);
  float gate = smoothstep(0.0, 0.03, edge.x) * smoothstep(0.0, 0.045, edge.y);
  float grain = (hash(floor(pictureUv * vec2(480.0, 270.0)) + uFrame * 17.0) - 0.5) * 0.06 * moving;
  vec3 lit = clamp(picture * flicker * hotspot + grain, 0.0, 1.0) * gate;

  // A bare wall baked under the open gate: the gate's light becomes the picture's. A roller screen baked with the lamp
  // off: the picture's light is added to the room's.
  vec3 underGate = bake * mix(vec3(1.0), uWall * uAmbient + (1.0 - uAmbient) * lit, uShown);
  vec3 thrown = bake + uShown * 0.85 * lit;
  vec3 light = mix(thrown, underGate, uGateBaked);
  float d = distance(vWorld, uLampPos) / uLampRange;
  light *= mix(vec3(1.0), uLampTint, 1.0 / (1.0 + 6.0 * d * d)) * uRoomTint;
  gl_FragColor = vec4(light, 1.0);
  #include <colorspace_fragment>
}
