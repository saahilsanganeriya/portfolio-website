// The land, water and landmarks of one city's half: its day and night pictures blended by how dark it is there. The
// darkness eases from San Francisco's (index 0) to Delhi's (index 1) with the sky's blend, so a city lit by day meets
// one lit by night without a line. Through dusk and dawn the light warms, and the far land takes the sky's horizon.
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform float uHasDay;
uniform float uHasNight;
uniform vec3 uCentre;
uniform vec3 uEye;
uniform vec3 uOut;
uniform vec3 uRight;
uniform float uBand;
uniform float uNightSide[2];
uniform float uDuskSide[2];
uniform vec3 uHorizonSide[2];
uniform vec2 uHaze;
varying vec2 vUv;
varying vec3 vWorld;

#include <window_blend>

void main() {
  float w = windowBlend(vWorld);
  float night = mix(uNightSide[0], uNightSide[1], w);
  float dusk = mix(uDuskSide[0], uDuskSide[1], w);
  vec3 day = texture2D(uDay, vUv).rgb;
  vec3 dark = texture2D(uNight, vUv).rgb;
  // Until a city's other picture arrives, its stand-in is the picture it has, dimmed or lifted.
  if (uHasNight < 0.5) dark = day * vec3(0.09, 0.10, 0.16);
  if (uHasDay < 0.5) day = min(dark * 2.4 + vec3(0.10, 0.12, 0.15), vec3(1.0));
  vec3 colour = blendDisplay(day, dark, night);
  float haze = smoothstep(uHaze.x, uHaze.y, dot(vWorld - uCentre, uOut));
  colour = mix(colour, mix(uHorizonSide[0], uHorizonSide[1], w), haze * (0.12 + 0.3 * dusk));
  colour *= mix(vec3(1.0), vec3(1.1, 0.86, 0.7), dusk * 0.5);
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
