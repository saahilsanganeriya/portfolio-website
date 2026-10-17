// A fibre print lit by the room's bake: the wall behind it is read at the print's own place (its affine UV map), and its
// brightness relative to the brightest spot under the darkroom's lamp sets the light the paper takes, so the prints sit
// in the same pool of light as the wall. A faint sheen catches the lamp as the view moves; the back of the paper is plain.
uniform sampler2D uMap;
uniform float uShown;
uniform vec3 uPaper;
uniform sampler2D uWallBake;
uniform mat3 uWallUvMatrix;
uniform float uUseWall;
uniform vec4 uWallU;
uniform vec4 uWallV;
uniform vec2 uRefUv;
uniform float uLight;
uniform vec3 uLampPos;
uniform vec3 uRoomTint;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  float light = uLight;
  if (uUseWall > 0.5) {
    vec2 wall = vec2(dot(uWallU.xyz, vWorld) + uWallU.w, dot(uWallV.xyz, vWorld) + uWallV.w);
    float here = luma(texture2D(uWallBake, (uWallUvMatrix * vec3(wall, 1.0)).xy).rgb);
    float brightest = max(luma(texture2D(uWallBake, (uWallUvMatrix * vec3(uRefUv, 1.0)).xy).rgb), 0.04);
    // Paper reflects far more than the painted wall, so it falls off more gently than the wall's own light does.
    light = clamp(pow(here / brightest, 0.65), 0.15, 1.05);
  }
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 toLamp = normalize(uLampPos - vWorld);
  float sheen = pow(max(dot(normal, normalize(toLamp + view)), 0.0), 40.0) * 0.05 + pow(1.0 - max(dot(normal, view), 0.0), 4.0) * 0.025;
  // A slight bias toward the sharper mip: the prints are read at about one texel per pixel.
  vec3 paper = gl_FrontFacing ? mix(uPaper, texture2D(uMap, vUv, -0.5).rgb, uShown) : uPaper * 0.82;
  gl_FragColor = vec4((paper + sheen) * light * uRoomTint, 1.0);
  #include <colorspace_fragment>
}
