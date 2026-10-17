// The finishing pass, from the scene's target to the canvas: the warm grade (a 3D table that also holds the tone
// curve), the practicals' bloom, the vignette, then a dither of at most half an 8-bit level. Nothing here changes from
// frame to frame. The canvas is premultiplied; pixels that are not fully opaque (the monitor's alpha hole and the glass
// over it) keep their colour and alpha, so the OS behind them is never graded, bloomed or darkened.
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler3D tLut;
uniform float uLutSize;
uniform float uGrade;
uniform float uBloom;
uniform float uVignette;
uniform float uDither;
varying vec2 vUv;

// Interleaved gradient noise (Jimenez 2014) in [0, 1), keyed on the pixel alone: the same pattern every frame, so the
// dither never moves while the camera drifts.
float ign(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec4 scene = texture2D(tScene, vUv);
  vec3 color = scene.rgb;
  float solid = step(0.999, scene.a);

  // Uniform branches: a tier without the grade or the bloom skips their lookups (SwiftShader pays for each one).
  if (uGrade > 0.0) {
    vec3 lutCoord = color * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    color = mix(color, texture(tLut, lutCoord).rgb, solid * uGrade);
  }
  if (uBloom > 0.0) {
    // Screen-blended, so a bright source rolls off instead of clipping; only on the room, so none lands on the OS.
    vec3 bloom = min(texture2D(tBloom, vUv).rgb * (uBloom * solid), vec3(1.0));
    color = 1.0 - (1.0 - color) * (1.0 - bloom);
  }

  vec2 centred = vUv - 0.5;
  float vignette = 1.0 - uVignette * smoothstep(0.3, 0.95, length(centred * vec2(1.15, 1.0)));
  color *= vignette;

  // ±uDither levels before the canvas rounds to 8 bits: a dark ramp lands on the levels either side of its true value
  // in the right proportion instead of in flat steps. A different offset per channel keeps the noise off one hue; the
  // OS behind the glass is left alone.
  if (uDither > 0.0) {
    vec2 pixel = gl_FragCoord.xy;
    vec3 noise = vec3(ign(pixel), ign(pixel + vec2(17.0, 31.0)), ign(pixel + vec2(59.0, 7.0))) - 0.5;
    color += noise * (2.0 * uDither / 255.0) * solid;
  }
  gl_FragColor = vec4(color, scene.a);
}
