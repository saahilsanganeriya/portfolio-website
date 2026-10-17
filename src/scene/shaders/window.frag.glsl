// The land, water and landmarks of one city's half, by day; the far land hazes into the sky's horizon, which runs
// from San Francisco's (index 0) to Delhi's (index 1) with the sky's blend.
uniform sampler2D uDay;
uniform vec3 uCentre;
uniform vec3 uOut;
uniform vec3 uHorizonSide[2];
uniform vec2 uHaze;
varying vec2 vUv;
varying vec3 vWorld;
varying float vBlend;

void main() {
  vec3 colour = texture2D(uDay, vUv).rgb;
  float haze = smoothstep(uHaze.x, uHaze.y, dot(vWorld - uCentre, uOut));
  colour = mix(colour, mix(uHorizonSide[0], uHorizonSide[1], vBlend), haze * 0.12);
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
