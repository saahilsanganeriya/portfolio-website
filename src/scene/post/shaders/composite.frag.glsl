// The finishing pass, from the scene's target to the canvas: the warm grade (a 3D table that also holds the tone
// curve), the practicals' bloom, then the old film pass's grain, vignette and projector flicker. The canvas is
// premultiplied; pixels that are not fully opaque (the monitor's alpha hole and the glass over it) keep their colour
// and alpha, so the OS behind them is never graded, bloomed or darkened.
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler3D tLut;
uniform float uLutSize;
uniform float uGrade;
uniform float uBloom;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uFlicker;
uniform float uGrainScale;
varying vec2 vUv;

// Dave Hoskins' hash12 (Hash without Sine, MIT): no visible lattice on integer cell coordinates.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 scene = texture2D(tScene, vUv);
  vec3 color = scene.rgb;
  float solid = step(0.999, scene.a);

  vec3 lutCoord = color * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
  color = mix(color, texture(tLut, lutCoord).rgb, solid * uGrade);

  // Screen-blended, so a bright source rolls off instead of clipping; only on the room, so none lands on the OS.
  vec3 bloom = min(texture2D(tBloom, vUv).rgb * (uBloom * solid), vec3(1.0));
  color = 1.0 - (1.0 - color) * (1.0 - bloom);

  float frame = mod(floor(uTime * 24.0), 64.0);
  float n = hash(floor(gl_FragCoord.xy / uGrainScale) + frame * vec2(37.0, 113.0));
  vec2 centred = vUv - 0.5;
  float vignette = 1.0 - uVignette * smoothstep(0.3, 0.95, length(centred * vec2(1.15, 1.0)));
  float gain = vignette * uFlicker;
  gl_FragColor = vec4(color * gain * (1.0 - uGrain + 2.0 * uGrain * n), scene.a);
}
