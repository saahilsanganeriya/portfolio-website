varying vec3 vSky;

void main() {
  gl_FragColor = vec4(vSky, 1.0);
  #include <colorspace_fragment>
}
