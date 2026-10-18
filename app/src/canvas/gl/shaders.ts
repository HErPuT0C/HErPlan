// Shaders of the graph renderer (ADR-002). Everything is drawn as instanced quads: shapes are signed
// distance fields in the fragment shader, which gives smooth edges without MSAA (cheap on integrated GPUs).

/** Shared camera uniforms: world → screen pixels → clip space. */
const CAMERA = `
uniform vec2 u_translate;   // camera offset, CSS px
uniform float u_scale;      // world → CSS px
uniform vec2 u_size;        // canvas size, CSS px
vec4 clipFromScreen(vec2 s) {
  vec2 c = s / u_size * 2.0 - 1.0;
  return vec4(c.x, -c.y, 0.0, 1.0);
}`;

/** Rounded boxes: nodes (with a header strip and a border) and group frames. */
export const BOX_VS = `#version 300 es
${CAMERA}
in vec2 a_corner;
in vec4 a_rect;      // x, y, w, h (world)
in vec4 a_body;      // fill colour
in vec4 a_head;      // header colour
in vec4 a_border;    // border colour
in vec4 a_shape;     // header height (world), corner radius (world), border width (px), unused
out vec2 v_local;    // position relative to the box centre, CSS px
out vec2 v_half;     // half size, CSS px
out vec4 v_body;
out vec4 v_head;
out vec4 v_border;
out vec3 v_shape;    // header height px, radius px, border px
void main() {
  float pad = 2.0;
  vec2 half_ = a_rect.zw * 0.5 * u_scale;
  vec2 center = (a_rect.xy + a_rect.zw * 0.5) * u_scale + u_translate;
  vec2 local = (a_corner * 2.0 - 1.0) * (half_ + pad);
  gl_Position = clipFromScreen(center + local);
  v_local = local;
  v_half = half_;
  v_body = a_body;
  v_head = a_head;
  v_border = a_border;
  v_shape = vec3(a_shape.x * u_scale, min(a_shape.y * u_scale, min(half_.x, half_.y)), a_shape.z);
}`;

export const BOX_FS = `#version 300 es
precision mediump float;
in vec2 v_local;
in vec2 v_half;
in vec4 v_body;
in vec4 v_head;
in vec4 v_border;
in vec3 v_shape;
out vec4 outColor;
float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = roundBox(v_local, v_half, v_shape.y);
  float coverage = clamp(0.5 - d, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  bool inHeader = v_local.y + v_half.y < v_shape.x;
  vec4 fill = inHeader ? v_head : v_body;
  float border = clamp(d + v_shape.z + 0.5, 0.0, 1.0);
  vec4 c = mix(fill, v_border, border * v_border.a);
  outColor = vec4(c.rgb, c.a * coverage);
}`;

/** Thick line segments for edges, with soft edges; segments of one curve overlap slightly at joints. */
export const SEG_VS = `#version 300 es
${CAMERA}
in vec2 a_corner;    // x: 0..1 along, y: -1..1 across
in vec4 a_seg;       // x0, y0, x1, y1 (world)
in vec4 a_color;
in float a_width;    // CSS px
out float v_across;
out float v_half;
out vec4 v_color;
void main() {
  vec2 p0 = a_seg.xy * u_scale + u_translate;
  vec2 p1 = a_seg.zw * u_scale + u_translate;
  vec2 d = p1 - p0;
  float len = max(length(d), 0.0001);
  vec2 dir = d / len;
  vec2 n = vec2(-dir.y, dir.x);
  float half_ = a_width * 0.5 + 1.0;
  vec2 along = mix(p0 - dir * half_ * 0.5, p1 + dir * half_ * 0.5, a_corner.x);
  gl_Position = clipFromScreen(along + n * a_corner.y * half_);
  v_across = a_corner.y * half_;
  v_half = a_width * 0.5;
  v_color = a_color;
}`;

export const SEG_FS = `#version 300 es
precision mediump float;
in float v_across;
in float v_half;
in vec4 v_color;
out vec4 outColor;
void main() {
  float a = clamp(v_half + 0.5 - abs(v_across), 0.0, 1.0);
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb, v_color.a * a);
}`;

/** Discs: ports, and arrow heads drawn as a disc-free triangle in the same pass would cost a program. */
export const DISC_VS = `#version 300 es
${CAMERA}
in vec2 a_corner;
in vec4 a_disc;      // x, y (world), radius (CSS px), ring width (CSS px; 0 = filled)
in vec4 a_color;
out vec2 v_local;
out vec2 v_shape;
out vec4 v_color;
void main() {
  // Ports shrink a little far away, so they do not swallow small nodes.
  float k = clamp(u_scale * 2.0, 0.5, 1.0);
  float r = a_disc.z * k + 1.0;
  vec2 local = (a_corner * 2.0 - 1.0) * r;
  gl_Position = clipFromScreen(a_disc.xy * u_scale + u_translate + local);
  v_local = local;
  v_shape = a_disc.zw * k;
  v_color = a_color;
}`;

export const DISC_FS = `#version 300 es
precision mediump float;
in vec2 v_local;
in vec2 v_shape;
in vec4 v_color;
out vec4 outColor;
void main() {
  float d = length(v_local) - v_shape.x;
  float a = clamp(0.5 - d, 0.0, 1.0);
  if (v_shape.y > 0.0) a *= clamp(d + v_shape.y + 0.5, 0.0, 1.0);
  if (a <= 0.0) discard;
  outColor = vec4(v_color.rgb, v_color.a * a);
}`;

/** Arrow heads at edge targets, pointing the way the edge enters the port. */
export const ARROW_VS = `#version 300 es
${CAMERA}
in vec2 a_corner;    // triangle corners: (0,0) (0,1) (1,0.5)
in vec2 a_tip;       // world
in vec2 a_dir;       // unit direction of the edge at the tip
in vec4 a_color;
out vec4 v_color;
void main() {
  float size = clamp(8.0 * u_scale, 3.0, 9.0);
  // The tip touches the port's ring instead of hiding under it.
  vec2 tip = a_tip * u_scale + u_translate - a_dir * clamp(5.0 * u_scale, 2.0, 5.0);
  vec2 along = a_dir;
  vec2 across = vec2(-a_dir.y, a_dir.x);
  vec2 p = tip + along * (a_corner.x - 1.0) * size + across * (a_corner.y - 0.5) * size;
  gl_Position = clipFromScreen(p);
  v_color = a_color;
}`;

export const FLAT_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() { outColor = v_color; }`;

/** Background dot grid every GRID world units; fades out when dots would crowd together. */
export const GRID_VS = `#version 300 es
in vec2 a_corner;
void main() { gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0); }`;

export const GRID_FS = `#version 300 es
precision mediump float;
uniform vec2 u_translate;   // CSS px
uniform float u_step;       // grid step, device px
uniform float u_dpr;
uniform float u_height;     // device px
uniform vec4 u_bg;
uniform vec4 u_dot;
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_height - gl_FragCoord.y) - u_translate * u_dpr;
  vec2 m = mod(p + 0.5 * u_dpr, u_step);
  float r = 1.0 * u_dpr;
  float dot_ = step(m.x, r * 2.0) * step(m.y, r * 2.0);
  float visible = smoothstep(8.0 * u_dpr, 16.0 * u_dpr, u_step);
  outColor = mix(u_bg, u_dot, dot_ * visible);
}`;
