// The reel as the projector throws it on the screen: the film's grey (or an intertitle card) sets how much light
// lands, between the unlit screen and the lamp's full light. Per film frame the picture weaves in the gate and the
// lamp flickers; grain runs over the top and the light falls off toward the corners. Written in display values,
// like the room's baked colours.
uniform sampler2D uVideo;
uniform sampler2D uCard;
uniform float uCardMix;
uniform float uFrame;
uniform float uOpacity;
uniform float uMargin;
uniform vec3 uDark;
uniform vec3 uLight;
varying vec2 vUv;

// Dave Hoskins' hash12 (Hash without Sine, MIT).
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 frame = (vUv - 0.5) * uMargin + 0.5;
  vec2 weave = (vec2(hash(vec2(uFrame, 1.7)), hash(vec2(uFrame, 9.1))) - 0.5) * vec2(0.004, 0.007);
  vec2 uv = frame + weave;
  float film = dot(texture2D(uVideo, uv).rgb, vec3(0.299, 0.587, 0.114));
  float card = texture2D(uCard, uv).r;
  float picture = mix(film, card, uCardMix);

  float flicker = 1.0 - 0.07 * hash(vec2(uFrame, 4.3));
  vec2 centred = frame - 0.5;
  float hotspot = 1.0 - 0.55 * dot(centred, centred) * 2.0;
  vec2 edge = min(uv, 1.0 - uv);
  float gate = smoothstep(0.0, 0.012, edge.x) * smoothstep(0.0, 0.016, edge.y);
  float grain = (hash(floor(frame * vec2(320.0, 240.0)) + uFrame * 17.0) - 0.5) * 0.09;

  float light = clamp(picture * flicker * hotspot + grain, 0.0, 1.0) * gate;
  gl_FragColor = vec4(mix(uDark, uLight, light), uOpacity);
}
