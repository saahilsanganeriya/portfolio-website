// A practical light's share of the bloom: where the scene's depth shows this surface is what the camera sees, its
// colour in the finished frame (or a constant glow, for the CRT whose screen is the OS hole) above a brightness knee.
#include <packing>
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uBias;
uniform vec3 uEmit;
uniform float uGain;
uniform vec2 uKnee;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float sceneZ = perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
  float ownZ = perspectiveDepthToViewZ(gl_FragCoord.z, uNear, uFar);
  if (ownZ < sceneZ - uBias) discard;
  vec3 color = dot(uEmit, uEmit) > 0.0 ? uEmit : texture2D(tScene, uv).rgb;
  float brightness = dot(color, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(color * smoothstep(uKnee.x, uKnee.y, brightness) * uGain, 1.0);
}
