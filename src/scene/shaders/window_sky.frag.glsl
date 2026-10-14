// The sky over both cities: one gradient that runs from San Francisco's sky (index 0, left) to Delhi's (index 1,
// right), each coloured by its own sun, blended across a wide band in the middle of the window (in display values, so
// the change looks centred on the seam whichever side is darker). The gradient's directions start at the dome's centre
// on the water line behind the window, so its horizon meets the water. The sun, the moon (with its phase) and stars are
// measured from the window framing's eye, so they are round from the room; their edges are one pixel wide.
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
uniform float uSunShown[2];
uniform vec3 uSunColour[2];
uniform vec3 uMoonDir[2];
uniform float uMoonShown[2];
uniform float uMoonAge;
uniform float uStars[2];
uniform float uTime;
varying vec3 vWorld;

#include <window_blend>

const float PI = 3.14159265;
const float SUN_R = 0.0115;
const float MOON_R = 0.0095;
const float STAR_CELL = 0.012;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 skyOf(int side, vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 colour = mix(uHorizon[side], uZenith[side], smoothstep(0.0, 1.0, pow(up, 0.55)));
  // The glow toward the sun hugs the horizon through dusk and dawn, wider than the sun itself.
  vec2 level = normalize(vec2(dot(d, uRight), dot(d, uOut)) + 1e-5);
  vec2 sunFlat = normalize(vec2(dot(uSunDir[side], uRight), dot(uSunDir[side], uOut)) + 1e-5);
  float toward = acos(clamp(dot(level, sunFlat), -1.0, 1.0));
  float glow = exp(-toward / 0.55) * (1.0 - smoothstep(0.0, 0.45, up));
  return colour + uGlow[side] * uGlowAmount[side] * glow * 0.55;
}

// The sun: a crisp disc and a soft glow around it (e: the direction from the eye).
vec3 sunOf(int side, vec3 e) {
  float angle = acos(clamp(dot(e, uSunDir[side]), -1.0, 1.0));
  float edge = max(fwidth(angle), 1e-5);
  float disc = 1.0 - smoothstep(SUN_R - edge, SUN_R + edge, angle);
  float halo = exp(-angle / 0.018) * 0.85 + exp(-angle / 0.055) * 0.34 + exp(-angle / 0.17) * 0.12;
  return (vec3(1.0, 0.98, 0.94) * disc * 1.4 + uSunColour[side] * halo) * uSunShown[side];
}

// The moon in its phase (lit on the right while it waxes) and a little glow; its dark part only dims the sky behind it,
// as earthshine does. Returns the light it adds and how much of the sky it dims.
vec4 moonOf(int side, vec3 e) {
  vec3 m = uMoonDir[side];
  float angle = acos(clamp(dot(e, m), -1.0, 1.0));
  float edge = max(fwidth(angle), 1e-5);
  float disc = 1.0 - smoothstep(MOON_R - edge, MOON_R + edge, angle);
  vec3 right = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
  vec3 top = cross(right, m);
  vec2 p = vec2(dot(e - m, right), dot(e - m, top)) / MOON_R;
  vec3 n = vec3(p, sqrt(max(0.0, 1.0 - dot(p, p))));
  float k = 2.0 * PI * uMoonAge;
  float lit = smoothstep(-0.06, 0.06, dot(n, vec3(sin(k), 0.0, -cos(k)))) * disc;
  float litShare = 0.5 - 0.5 * cos(k);
  float halo = exp(-angle / 0.022) * 0.14 * litShare * (1.0 - disc);
  vec3 light = vec3(0.93, 0.91, 0.85) * (0.82 + 0.18 * n.z) * lit + vec3(0.62, 0.66, 0.78) * halo;
  return vec4(light, (disc * 0.25 + lit * 0.75)) * uMoonShown[side];
}

// Stars, laid out by the direction from the eye; they fade out toward the horizon (d, from the dome's centre).
float starsAt(vec3 e, vec3 d) {
  float az = atan(dot(e, uRight), dot(e, uOut));
  float el = asin(clamp(e.y, -1.0, 1.0));
  float altitude = asin(clamp(d.y, -1.0, 1.0));
  vec2 at = vec2(az, el) / STAR_CELL;
  vec2 cell = floor(at);
  float pick = hash(cell);
  if (pick < 0.965 || altitude < 0.07) return 0.0;
  vec2 centre = cell + 0.2 + 0.6 * vec2(hash(cell + 3.1), hash(cell + 7.7));
  vec2 offset = (at - centre) * STAR_CELL;
  offset.x *= cos(el);
  float dist = length(offset);
  float size = 0.0005 + 0.0006 * hash(cell + 1.3);
  float edge = max(fwidth(dist), 1e-5);
  float twinkle = 0.78 + 0.22 * sin(uTime * (1.3 + hash(cell + 5.0)) + 6.283 * pick);
  return (1.0 - smoothstep(size - edge, size + edge, dist)) * (0.55 + 0.45 * hash(cell + 9.2)) * twinkle *
         smoothstep(0.07, 0.2, altitude);
}

void main() {
  vec3 d = normalize(vWorld - uCentre);
  vec3 e = normalize(vWorld - uEye);
  float w = windowBlend(vWorld);
  vec3 colour = blendDisplay(skyOf(0, d), skyOf(1, d), w);
  colour += vec3(0.86, 0.88, 1.0) * starsAt(e, d) * mix(uStars[0], uStars[1], w);
  for (int side = 0; side < 2; side++) {
    colour += sunOf(side, e);
    vec4 moon = moonOf(side, e);
    colour = colour * (1.0 - moon.a) + moon.rgb;
  }
  gl_FragColor = vec4(min(colour, vec3(1.0)), 1.0);
  #include <colorspace_fragment>
}
