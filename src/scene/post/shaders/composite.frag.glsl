// The finishing pass, from the scene's target to the canvas: the warm grade (a 3D table that also holds the tone
// curve), the practicals' bloom, then the vignette. Nothing here changes from frame to frame. The canvas is
// premultiplied; pixels that are not fully opaque (the monitor's alpha hole and the glass over it) keep their colour
// and alpha, so the OS behind them is never graded, bloomed or darkened.
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler3D tLut;
uniform float uLutSize;
uniform float uGrade;
uniform float uBloom;
uniform float uVignette;
varying vec2 vUv;

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
  gl_FragColor = vec4(color * vignette, scene.a);
}
