import { HEADER_H, KINDS, SpatialGrid, type Graph } from './graph';
import { lodFor, type Renderer, type RenderStats } from './renderer';
import { visibleWorldRect, type Viewport } from './viewport';

// GPU renderer: instanced quads for node bodies and headers, tessellated line segments for edges,
// a shader-drawn dot grid. Text and ports go to a small 2D overlay and only for the nodes on screen
// at readable zoom. Geometry lives in GPU buffers and is rebuilt only when a node moves.

const VS_QUAD = `#version 300 es
in vec2 a_corner;            // 0..1 unit quad
in vec4 a_rect;              // x, y, w, h in world units
in vec4 a_color;
uniform vec2 u_translate;    // screen px
uniform float u_scale;
uniform vec2 u_size;         // canvas size in CSS px
out vec4 v_color;
void main() {
  vec2 world = a_rect.xy + a_corner * a_rect.zw;
  vec2 screen = world * u_scale + u_translate;
  gl_Position = vec4(screen / u_size * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
  v_color = a_color;
}`;

const VS_LINE = `#version 300 es
in vec2 a_pos;
uniform vec2 u_translate;
uniform float u_scale;
uniform vec2 u_size;
void main() {
  vec2 screen = a_pos * u_scale + u_translate;
  gl_Position = vec4(screen / u_size * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;

const FS_COLOR = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() { outColor = v_color; }`;

const FS_UNIFORM = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;

const VS_FULL = `#version 300 es
in vec2 a_corner;
void main() { gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0); }`;

const FS_DOTS = `#version 300 es
precision mediump float;
uniform vec2 u_translate;
uniform float u_step;        // dot spacing in device px
uniform float u_dpr;
uniform float u_height;      // canvas height in device px
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_height - gl_FragCoord.y) - u_translate * u_dpr;
  vec2 m = mod(p, u_step);
  float dot = step(m.x, 1.5 * u_dpr) * step(m.y, 1.5 * u_dpr);
  outColor = mix(vec4(0.078, 0.086, 0.106, 1.0), vec4(0.149, 0.165, 0.2, 1.0), dot * step(12.0 * u_dpr, u_step));
}`;

function hexToRgba(hex: string, a = 1): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

const BODY = hexToRgba('#1f232b');
const SEGMENTS = 12;

export interface WebGLOptions {
  // When false, node bodies, headers and text are left to another layer (used by the hybrid renderer).
  drawNodesUpClose: boolean;
}

export class WebGLRenderer implements Renderer {
  readonly name: string;
  private root = document.createElement('div');
  private canvas = document.createElement('canvas');
  private overlay = document.createElement('canvas');
  private gl!: WebGL2RenderingContext;
  private octx = this.overlay.getContext('2d')!;
  private graph!: Graph;
  private grid!: SpatialGrid;
  private visible = new Set<number>();
  private width = 0;
  private height = 0;
  private dpr = 1;
  private quadProg!: WebGLProgram;
  private lineProg!: WebGLProgram;
  private dotsProg!: WebGLProgram;
  private quadVao!: WebGLVertexArrayObject;
  private headerVao!: WebGLVertexArrayObject;
  private farVao!: WebGLVertexArrayObject;
  private curveVao!: WebGLVertexArrayObject;
  private straightVao!: WebGLVertexArrayObject;
  private dotsVao!: WebGLVertexArrayObject;
  private bodyBuf!: WebGLBuffer;
  private headerBuf!: WebGLBuffer;
  private farBuf!: WebGLBuffer;
  private curveBuf!: WebGLBuffer;
  private straightBuf!: WebGLBuffer;
  private curveVerts = 0;
  private straightVerts = 0;
  private overlayDirty = false;

  constructor(private options: WebGLOptions = { drawNodesUpClose: true }) {
    this.name = options.drawNodesUpClose ? 'WebGL' : 'WebGL (связи)';
  }

  mount(host: HTMLElement): void {
    Object.assign(this.root.style, { position: 'absolute', inset: '0' });
    for (const c of [this.canvas, this.overlay]) Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    this.overlay.style.pointerEvents = 'none';
    this.root.append(this.canvas, this.overlay);
    host.appendChild(this.root);
    const gl = this.canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.gl = gl;
    this.quadProg = compile(gl, VS_QUAD, FS_COLOR);
    this.lineProg = compile(gl, VS_LINE, FS_UNIFORM);
    this.dotsProg = compile(gl, VS_FULL, FS_DOTS);
    this.bodyBuf = gl.createBuffer()!;
    this.headerBuf = gl.createBuffer()!;
    this.farBuf = gl.createBuffer()!;
    this.curveBuf = gl.createBuffer()!;
    this.straightBuf = gl.createBuffer()!;
    const corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const quadVao = (instances: WebGLBuffer) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const aCorner = gl.getAttribLocation(this.quadProg, 'a_corner');
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.enableVertexAttribArray(aCorner);
      gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, instances);
      const aRect = gl.getAttribLocation(this.quadProg, 'a_rect');
      const aColor = gl.getAttribLocation(this.quadProg, 'a_color');
      gl.enableVertexAttribArray(aRect);
      gl.vertexAttribPointer(aRect, 4, gl.FLOAT, false, 32, 0);
      gl.vertexAttribDivisor(aRect, 1);
      gl.enableVertexAttribArray(aColor);
      gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, 32, 16);
      gl.vertexAttribDivisor(aColor, 1);
      return vao;
    };
    this.quadVao = quadVao(this.bodyBuf);
    this.headerVao = quadVao(this.headerBuf);
    this.farVao = quadVao(this.farBuf);
    const lineVao = (buf: WebGLBuffer) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const aPos = gl.getAttribLocation(this.lineProg, 'a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      return vao;
    };
    this.curveVao = lineVao(this.curveBuf);
    this.straightVao = lineVao(this.straightBuf);
    this.dotsVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.dotsVao);
    const aCornerFull = gl.getAttribLocation(this.dotsProg, 'a_corner');
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(aCornerFull);
    gl.vertexAttribPointer(aCornerFull, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  setGraph(graph: Graph): void {
    this.graph = graph;
    this.grid = new SpatialGrid(graph);
    this.upload();
  }

  private upload(): void {
    const { gl, graph } = this;
    const n = graph.nodes.length;
    const body = new Float32Array(n * 8);
    const header = new Float32Array(n * 8);
    const far = new Float32Array(n * 8);
    graph.nodes.forEach((node, i) => {
      const kind = hexToRgba(KINDS[node.kind].color);
      body.set([node.x, node.y, node.w, node.h, ...BODY], i * 8);
      header.set([node.x, node.y, node.w, HEADER_H, ...kind], i * 8);
      far.set([node.x, node.y, node.w, node.h, ...kind], i * 8);
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, body, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.headerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, header, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.farBuf);
    gl.bufferData(gl.ARRAY_BUFFER, far, gl.DYNAMIC_DRAW);

    const { edgeFrom, edgeTo, nodes } = graph;
    const curves = new Float32Array(edgeFrom.length * SEGMENTS * 4);
    const straight = new Float32Array(edgeFrom.length * 4);
    let c = 0;
    for (let e = 0; e < edgeFrom.length; e++) {
      const a = nodes[edgeFrom[e]], b = nodes[edgeTo[e]];
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
      straight.set([x1, y1, x2, y2], e * 4);
      const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
      let px = x1, py = y1;
      for (let s = 1; s <= SEGMENTS; s++) {
        const t = s / SEGMENTS, u = 1 - t;
        const x = u * u * u * x1 + 3 * u * u * t * (x1 + dx) + 3 * u * t * t * (x2 - dx) + t * t * t * x2;
        const y = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
        curves[c++] = px; curves[c++] = py; curves[c++] = x; curves[c++] = y;
        px = x; py = y;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.curveBuf);
    gl.bufferData(gl.ARRAY_BUFFER, curves, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.straightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, straight, gl.DYNAMIC_DRAW);
    this.curveVerts = c / 2;
    this.straightVerts = edgeFrom.length * 2;
  }

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1;
    this.width = width;
    this.height = height;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(width * this.dpr);
      c.height = Math.round(height * this.dpr);
    }
  }

  nodeMoved(): void {
    this.grid.rebuild();
    this.upload();
  }

  hitTest(sx: number, sy: number, v: Viewport): number {
    const wx = (sx - v.tx) / v.scale, wy = (sy - v.ty) / v.scale;
    const hits = new Set<number>();
    this.grid.query(wx, wy, wx, wy, hits);
    let found = -1;
    for (const i of hits) {
      const n = this.graph.nodes[i];
      if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) found = Math.max(found, i);
    }
    return found;
  }

  render(v: Viewport): RenderStats {
    const { gl } = this;
    const lod = lodFor(v.scale);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.useProgram(this.dotsProg);
    gl.uniform2f(gl.getUniformLocation(this.dotsProg, 'u_translate'), v.tx, v.ty);
    gl.uniform1f(gl.getUniformLocation(this.dotsProg, 'u_step'), 40 * v.scale * this.dpr);
    gl.uniform1f(gl.getUniformLocation(this.dotsProg, 'u_dpr'), this.dpr);
    gl.uniform1f(gl.getUniformLocation(this.dotsProg, 'u_height'), this.canvas.height);
    gl.bindVertexArray(this.dotsVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.lineProg);
    gl.uniform2f(gl.getUniformLocation(this.lineProg, 'u_translate'), v.tx, v.ty);
    gl.uniform1f(gl.getUniformLocation(this.lineProg, 'u_scale'), v.scale);
    gl.uniform2f(gl.getUniformLocation(this.lineProg, 'u_size'), this.width, this.height);
    gl.uniform4f(gl.getUniformLocation(this.lineProg, 'u_color'), 0.59, 0.65, 0.75, 0.55);
    if (lod === 'far') {
      gl.bindVertexArray(this.straightVao);
      gl.drawArrays(gl.LINES, 0, this.straightVerts);
    } else {
      gl.bindVertexArray(this.curveVao);
      gl.drawArrays(gl.LINES, 0, this.curveVerts);
    }

    const n = this.graph.nodes.length;
    gl.useProgram(this.quadProg);
    gl.uniform2f(gl.getUniformLocation(this.quadProg, 'u_translate'), v.tx, v.ty);
    gl.uniform1f(gl.getUniformLocation(this.quadProg, 'u_scale'), v.scale);
    gl.uniform2f(gl.getUniformLocation(this.quadProg, 'u_size'), this.width, this.height);
    if (lod === 'far') {
      gl.bindVertexArray(this.farVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    } else if (this.options.drawNodesUpClose) {
      gl.bindVertexArray(this.quadVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.bindVertexArray(this.headerVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    gl.bindVertexArray(null);

    // Text overlay: only nodes on screen, only at readable zoom.
    const r = visibleWorldRect(v, this.width, this.height);
    this.grid.query(r.minX, r.minY, r.maxX, r.maxY, this.visible);
    const ctx = this.octx;
    if (this.options.drawNodesUpClose && v.scale >= 0.4) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      ctx.setTransform(this.dpr * v.scale, 0, 0, this.dpr * v.scale, this.dpr * v.tx, this.dpr * v.ty);
      ctx.textBaseline = 'middle';
      ctx.font = '600 13px system-ui, "Segoe UI", sans-serif';
      ctx.fillStyle = '#e8ebf1';
      for (const i of this.visible) {
        const node = this.graph.nodes[i];
        ctx.fillText(node.title, node.x + 10, node.y + HEADER_H / 2, node.w - 20);
      }
      if (lod === 'near') {
        ctx.font = '12px system-ui, "Segoe UI", sans-serif';
        ctx.fillStyle = '#a9b0bd';
        for (const i of this.visible) {
          const node = this.graph.nodes[i];
          ctx.fillText(node.line1, node.x + 10, node.y + HEADER_H + 20, node.w - 20);
          ctx.fillText(node.line2, node.x + 10, node.y + HEADER_H + 40, node.w - 20);
        }
      }
      this.overlayDirty = true;
    } else if (this.overlayDirty) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      this.overlayDirty = false;
    }
    return { nodes: this.visible.size, edges: this.graph.edgeFrom.length, lod };
  }

  destroy(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.root.remove();
  }
}
