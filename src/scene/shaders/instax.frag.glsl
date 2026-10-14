// An Instax print on the board: its card and photograph lit like the baked wall around it (art.frag's light, the lava
// lamp's colour on top), plus what makes it read as a print: the photo's glossy face catches the picture lamp over the
// board as the camera moves, and the card curls a little, so one edge takes a touch more light than the other.
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
uniform vec3 uLampTint;
uniform vec3 uRoomTint;
uniform vec3 uLampPos;
uniform float uLampRange;
uniform vec4 uWindow;
uniform vec3 uNormal;
uniform vec3 uTangent;
uniform vec2 uCurl;
uniform vec3 uGlossLight;
uniform float uGloss;
uniform vec2 uFlip;
varying vec2 vUv;
varying vec2 vBakeUv;
varying vec3 vWorld;

void main() {
  // The print reads left to right and top down whichever way the slot's UVs run.
  vec2 uv = mix(vUv, 1.0 - vUv, uFlip);
  vec3 art = mix(uPaper, texture2D(uMap, uv).rgb, uShown);
  float above = max(0.0, uTopY - vWorld.y);
  vec3 light = uUseBake > 0.5 ? texture2D(uBake, vBakeUv).rgb * uBakeGain : vec3(uAmbient + uTop * exp(-above / uTopFall));
  float d = distance(vWorld, uLampPos) / uLampRange;
  light *= mix(vec3(1.0), uLampTint, 1.0 / (1.0 + 6.0 * d * d)) * uRoomTint;

  // The curl bends the face's normal toward its edges; the shading follows the bent normal.
  vec2 c = uv - 0.5;
  vec3 bitangent = cross(uNormal, uTangent);
  vec3 normal = normalize(uNormal + uTangent * (c.x * uCurl.x * 2.0) + bitangent * (c.y * uCurl.y * 2.0));
  float curl = 1.0 + 0.08 * (dot(normal, normalize(uGlossLight - vWorld)) - dot(uNormal, normalize(uGlossLight - vWorld)));

  vec3 colour = art * light * curl;
  vec2 inside = step(uWindow.xy, uv) * step(uv, uWindow.zw);
  if (inside.x * inside.y > 0.5) {
    vec3 view = normalize(cameraPosition - vWorld);
    vec3 toLight = normalize(uGlossLight - vWorld);
    float spec = pow(max(dot(reflect(-toLight, normal), view), 0.0), 18.0);
    float sheen = pow(1.0 - max(dot(normal, view), 0.0), 3.0) * 0.06;
    colour += (spec * uGloss + sheen) * light;
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
