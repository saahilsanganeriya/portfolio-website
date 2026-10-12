// One half of the window view: its day and night pictures blended by how dark it is, warmed through dusk and dawn,
// low on the horizon first. How dark is San Francisco's on the left and Delhi's on the right, eased across the seam
// between the halves (their pictures match at the seam by day and by night), so the two skies meet softly.
uniform sampler2D uDay;
uniform sampler2D uNight;
uniform float uNightLeft;
uniform float uNightRight;
uniform float uSeamX;
uniform float uSeamBand;
uniform float uHasDay;
uniform float uHasNight;
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  float night = mix(uNightLeft, uNightRight, smoothstep(uSeamX - uSeamBand, uSeamX + uSeamBand, vWorld.x));
  // Until the other picture arrives the half shows the one it has.
  float mixNight = uHasDay > 0.5 && uHasNight > 0.5 ? night : uHasNight;
  vec3 colour = mix(texture2D(uDay, vUv).rgb, texture2D(uNight, vUv).rgb, mixNight);
  float dusk = 1.0 - abs(2.0 * night - 1.0);
  float horizon = smoothstep(0.15, 0.85, vUv.y);
  colour *= mix(vec3(1.0), vec3(1.12, 0.82, 0.62), dusk * 0.7 * horizon);
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
