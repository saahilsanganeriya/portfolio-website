// Art that is not baked into the room (posters, prints), lit like the baked wall around it. When the room bakes the
// light that falls on the surface as white paper (a second UV set into the atlas), the art is multiplied by that
// light; otherwise by an ambient level and the picture light above, falling off downward. The lava lamp's warm light
// is added on top, falling off with distance.
uniform sampler2D uMap;
uniform float uShown;
uniform vec3 uPaper;
uniform sampler2D uBake;
uniform float uUseBake;
uniform float uBakeGain;
uniform float uAmbient;
uniform float uTop;
uniform float uTopY;
uniform float uTopFall;
uniform vec3 uLampColor;
uniform vec3 uLampPos;
uniform float uLampRange;
varying vec2 vUv;
varying vec2 vBakeUv;
varying vec3 vWorld;

void main() {
  vec3 art = mix(uPaper, texture2D(uMap, vUv).rgb, uShown);
  float above = max(0.0, uTopY - vWorld.y);
  vec3 light = uUseBake > 0.5 ? texture2D(uBake, vBakeUv).rgb * uBakeGain : vec3(uAmbient + uTop * exp(-above / uTopFall));
  float d = distance(vWorld, uLampPos) / uLampRange;
  gl_FragColor = vec4(art * (light + uLampColor / (1.0 + d * d)), 1.0);
  #include <colorspace_fragment>
}
