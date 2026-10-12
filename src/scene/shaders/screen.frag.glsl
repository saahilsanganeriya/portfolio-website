// The projector's picture on its screen: the frame's light (grey for the reel and its cards, colour for the
// photographs) sets how much light lands, between the unlit screen and the lamp's full light. Per film frame the
// picture weaves in the gate and the lamp flickers; grain runs over the top and the light falls off toward the
// corners. A program change rolls the film: frame A slides up out of the gate, frame B follows with the frame line
// between them. Written in display values, like the room's baked colours.
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMixB;
uniform float uRoll;
uniform float uColour;
uniform float uFrame;
uniform float uOpacity;
uniform float uMargin;
uniform vec3 uDark;
uniform vec3 uLight;
varying vec2 vUv;

const float FRAME_LINE = 0.08;

// Dave Hoskins' hash12 (Hash without Sine, MIT).
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 frameAt(vec2 uv) {
  if (uRoll <= 0.0) return mix(texture2D(uA, uv).rgb, texture2D(uB, uv).rgb, uMixB);
  float ya = uv.y - uRoll * (1.0 + FRAME_LINE);
  float yb = ya + 1.0 + FRAME_LINE;
  if (ya >= 0.0) return texture2D(uA, vec2(uv.x, ya)).rgb;
  if (yb <= 1.0) return texture2D(uB, vec2(uv.x, yb)).rgb;
  return vec3(0.0);
}

void main() {
  vec2 frame = (vUv - 0.5) * uMargin + 0.5;
  vec2 weave = (vec2(hash(vec2(uFrame, 1.7)), hash(vec2(uFrame, 9.1))) - 0.5) * vec2(0.004, 0.007);
  vec2 uv = frame + weave;
  vec3 rgb = frameAt(uv);
  vec3 picture = mix(vec3(dot(rgb, vec3(0.299, 0.587, 0.114))), rgb, uColour);

  float flicker = 1.0 - 0.07 * hash(vec2(uFrame, 4.3)) + 0.3 * sin(uRoll * 3.14159);
  vec2 centred = frame - 0.5;
  float hotspot = 1.0 - 0.55 * dot(centred, centred) * 2.0;
  vec2 edge = min(uv, 1.0 - uv);
  float gate = smoothstep(0.0, 0.012, edge.x) * smoothstep(0.0, 0.016, edge.y);
  float grain = (hash(floor(frame * vec2(320.0, 240.0)) + uFrame * 17.0) - 0.5) * 0.09;

  vec3 light = clamp(picture * flicker * hotspot + grain, 0.0, 1.0) * gate;
  gl_FragColor = vec4(mix(uDark, uLight, light), uOpacity);
}
