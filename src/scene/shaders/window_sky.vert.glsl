// The sky's gradient, per vertex (the dome is fine enough and the gradient smooth): each city's colours by its own sun,
// from the horizon to the zenith with a warm glow toward its sun through dusk and dawn, blended from San Francisco's
// (index 0, left) to Delhi's (index 1, right) across a wide band in the middle of the window, in display values so the
// change looks centred on the seam. Directions start at the dome's centre on the water line, so the horizon meets the
// water.
uniform vec3 uCentre;
uniform vec3 uEye;
uniform vec3 uOut;
uniform vec3 uRight;
uniform float uBand;
uniform vec3 uZenith[2];
uniform vec3 uHorizon[2];
uniform vec3 uGlow[2];
uniform float uGlowAmount[2];
uniform vec3 uSunDir[2];
varying vec3 vWorld;
varying vec3 vSky;
varying float vBlend;

#include <window_blend>

vec3 skyOf(int side, vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 colour = mix(uHorizon[side], uZenith[side], smoothstep(0.0, 1.0, pow(up, 0.55)));
  // The glow toward the sun hugs the horizon through dusk and dawn, wider than the sun itself.
  vec2 level = normalize(vec2(dot(d, uRight), dot(d, uOut)) + 1e-5);
  vec2 sunFlat = normalize(vec2(dot(uSunDir[side], uRight), dot(uSunDir[side], uOut)) + 1e-5);
  float toward = length(level - sunFlat);
  float glow = exp(-toward / 0.55) * (1.0 - smoothstep(0.0, 0.45, up));
  return colour + uGlow[side] * uGlowAmount[side] * glow * 0.55;
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec3 d = normalize(world.xyz - uCentre);
  vBlend = windowBlend(world.xyz);
  vSky = blendDisplay(skyOf(0, d), skyOf(1, d), vBlend);
  gl_Position = projectionMatrix * viewMatrix * world;
}
