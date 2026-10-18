// The plane's trail: a ribbon along the arc behind it, narrow at the plane and wider as it ages. aRoute is how far
// along the route the vertex lies (0 over New Delhi, 1 over San Francisco), aSide which edge of the ribbon it is.
attribute vec3 aCentre;
attribute vec3 aAcross;
attribute float aRoute;
attribute float aSide;
uniform float uHead;
uniform float uLength;
uniform vec2 uWidth;
varying float vAge;
varying float vSide;

void main() {
  vAge = (uHead - aRoute) / uLength;
  vSide = aSide;
  vec3 p = aCentre + aAcross * aSide * mix(uWidth.x, uWidth.y, clamp(vAge, 0.0, 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
