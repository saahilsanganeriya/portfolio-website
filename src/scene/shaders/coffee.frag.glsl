// The coffee's surface in the cup: dark espresso under a crema that forms as the cup fills, mottled like real crema
// (tiger flecks) and lighter at the middle where the stream lands, with a darker ring where it meets the cup.
uniform vec3 uCentre;
uniform float uRadius;
uniform float uCrema;
uniform float uSwirl;
uniform float uLight;
varying vec3 vWorld;

// Dave Hoskins' hash12 (Hash without Sine, MIT).
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 d = (vWorld.xz - uCentre.xz) / max(uRadius, 1e-3);
  float r = length(d);
  float angle = atan(d.y, d.x) + uSwirl * 0.15 * (1.0 - r);
  vec2 swirled = vec2(cos(angle), sin(angle)) * r;
  float flecks = noise(swirled * 9.0) * 0.6 + noise(swirled * 23.0) * 0.4;
  // Linear colours (the output is converted to sRGB): near-black espresso, a hazel to caramel crema.
  vec3 espresso = vec3(0.03, 0.012, 0.004);
  vec3 crema = mix(vec3(0.36, 0.15, 0.045), vec3(0.56, 0.28, 0.09), flecks);
  crema = mix(crema, vec3(0.64, 0.36, 0.13), smoothstep(0.45, 0.0, r) * 0.5);
  vec3 colour = mix(espresso, crema, uCrema * smoothstep(1.05, 0.55, r * (1.15 - 0.3 * uCrema)));
  colour *= mix(0.55, 1.0, smoothstep(1.0, 0.82, r));
  gl_FragColor = vec4(colour * uLight, 1.0);
  #include <colorspace_fragment>
}
