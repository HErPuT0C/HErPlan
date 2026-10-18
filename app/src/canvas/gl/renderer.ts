// WebGL2 renderer of a graph (ADR-002): background grid, group frames, edges with arrows, nodes and ports.
// It draws prepared batches (scene.ts) and uploads a batch only when it changes, so panning and zooming
// cost one draw call per layer and no JavaScript work per node.

import type { Camera } from '../camera';
import { ARROW_VS, BOX_FS, BOX_VS, DISC_FS, DISC_VS, FLAT_FS, GRID_FS, GRID_VS, SEG_FS, SEG_VS } from './shaders';

export type Rgba = [number, number, number, number];

export interface Batch {
  data: Float32Array;
  count: number;
  /**
   * Instances grouped by area of the graph: only groups that touch the view are drawn.
   * Without ranges the whole batch is drawn.
   */
  ranges?: BatchRange[];
}

export interface BatchRange {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  start: number;
  count: number;
}

/** Floats per instance in each batch kind. */
export const BOX_STRIDE = 20; // rect4, body4, head4, border4, shape4
export const SEG_STRIDE = 9; // seg4, color4, width1
export const DISC_STRIDE = 8; // disc4, color4
export const ARROW_STRIDE = 8; // tip2, dir2, color4

export const EMPTY_BATCH: Batch = { data: new Float32Array(0), count: 0 };

/** Layers to skip, for diagnosing slow frames from the benchmark page (`#/dev/canvas-bench?skip=edges,grid`). */
export const skipLayers = new Set<string>();

export interface Frame {
  camera: Camera;
  groups: Batch;
  edges: Batch;
  arrows: Batch;
  nodes: Batch;
  ports: Batch;
  /** Selection rectangle, edge being dragged, ports of the hovered node: small, rebuilt as needed. */
  overlayBoxes: Batch;
  overlaySegs: Batch;
  overlayDiscs: Batch;
  grid: { bg: Rgba; dot: Rgba; step: number };
}

interface Layer {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  uploaded: Batch | null;
  capacity: number;
  /** Instanced attributes, to point them at a sub-range of the buffer. */
  attrs: { loc: number; size: number; offset: number }[];
  stride: number;
}

interface Program {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[]): Program {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
  const u: Program['u'] = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(program, name);
  return { program, u };
}

const CAMERA_UNIFORMS = ['u_translate', 'u_scale', 'u_size'];

export class GraphRenderer {
  private gl!: WebGL2RenderingContext;
  private box!: Program;
  private seg!: Program;
  private disc!: Program;
  private arrow!: Program;
  private grid!: Program;
  private layers = new Map<string, Layer>();
  private gridVao!: WebGLVertexArrayObject;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private lost = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onRestored: () => void,
  ) {
    canvas.addEventListener('webglcontextlost', (e) => {
      // Sleep, driver update: keep the page alive and rebuild everything when the context comes back.
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.init();
      this.onRestored();
    });
    this.init();
  }

  /** "Intel(R) HD Graphics 620" or similar; for bug reports and the benchmark. */
  get gpu(): string {
    const info = this.gl.getExtension('WEBGL_debug_renderer_info');
    return String(this.gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : this.gl.RENDERER));
  }

  private init(): void {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.layers.clear();
    this.box = compile(gl, BOX_VS, BOX_FS, CAMERA_UNIFORMS);
    this.seg = compile(gl, SEG_VS, SEG_FS, CAMERA_UNIFORMS);
    this.disc = compile(gl, DISC_VS, DISC_FS, CAMERA_UNIFORMS);
    this.arrow = compile(gl, ARROW_VS, FLAT_FS, CAMERA_UNIFORMS);
    this.grid = compile(gl, GRID_VS, GRID_FS, ['u_translate', 'u_step', 'u_dpr', 'u_height', 'u_bg', 'u_dot']);

    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const segQuad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, segQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const tri = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 0, 1, 1, 0.5]), gl.STATIC_DRAW);

    const layer = (name: string, program: Program, corners: WebGLBuffer, attrs: [string, number][]) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const corner = gl.getAttribLocation(program.program, 'a_corner');
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.enableVertexAttribArray(corner);
      gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = attrs.reduce((sum, [, size]) => sum + size, 0) * 4;
      let offset = 0;
      const layout: Layer['attrs'] = [];
      for (const [attr, size] of attrs) {
        const loc = gl.getAttribLocation(program.program, attr);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
        gl.vertexAttribDivisor(loc, 1);
        layout.push({ loc, size, offset });
        offset += size * 4;
      }
      this.layers.set(name, { vao, buffer, uploaded: null, capacity: 0, attrs: layout, stride });
    };
    const boxAttrs: [string, number][] = [
      ['a_rect', 4],
      ['a_body', 4],
      ['a_head', 4],
      ['a_border', 4],
      ['a_shape', 4],
    ];
    const segAttrs: [string, number][] = [
      ['a_seg', 4],
      ['a_color', 4],
      ['a_width', 1],
    ];
    layer('groups', this.box, quad, boxAttrs);
    layer('nodes', this.box, quad, boxAttrs);
    layer('overlayBoxes', this.box, quad, boxAttrs);
    layer('edges', this.seg, segQuad, segAttrs);
    layer('overlaySegs', this.seg, segQuad, segAttrs);
    layer('ports', this.disc, quad, [
      ['a_disc', 4],
      ['a_color', 4],
    ]);
    layer('arrows', this.arrow, tri, [
      ['a_tip', 2],
      ['a_dir', 2],
      ['a_color', 4],
    ]);
    layer('overlayDiscs', this.disc, quad, [
      ['a_disc', 4],
      ['a_color', 4],
    ]);

    this.gridVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.gridVao);
    const corner = gl.getAttribLocation(this.grid.program, 'a_corner');
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
  }

  private upload(name: string, batch: Batch): Layer | null {
    const layer = this.layers.get(name)!;
    if (batch.count === 0) return null;
    if (layer.uploaded !== batch) {
      const { gl } = this;
      gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
      if (batch.data.byteLength > layer.capacity) {
        gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.DYNAMIC_DRAW);
        layer.capacity = batch.data.byteLength;
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data);
      }
      layer.uploaded = batch;
    }
    return layer;
  }

  private useCamera(p: Program, c: Camera): void {
    const { gl } = this;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.u_translate, c.x, c.y);
    gl.uniform1f(p.u.u_scale, c.scale);
    gl.uniform2f(p.u.u_size, this.width, this.height);
  }

  private drawLayer(name: string, batch: Batch, p: Program, c: Camera, vertices: number, mode: number): void {
    if (skipLayers.has(name)) return;
    const layer = this.upload(name, batch);
    if (!layer) return;
    const { gl } = this;
    this.useCamera(p, c);
    gl.bindVertexArray(layer.vao);
    if (!batch.ranges) {
      gl.drawArraysInstanced(mode, 0, vertices, batch.count);
      return;
    }
    // Draw only the areas that touch the view; WebGL2 has no base instance, so re-point the attributes.
    const minX = -c.x / c.scale;
    const minY = -c.y / c.scale;
    const maxX = (this.width - c.x) / c.scale;
    const maxY = (this.height - c.y) / c.scale;
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
    // Ranges are consecutive in the buffer, so neighbouring visible ranges merge into one draw call:
    // the whole graph in view is a single call, a close-up view a handful.
    let runStart = -1;
    let runCount = 0;
    const flush = () => {
      if (runCount === 0) return;
      for (const a of layer.attrs) {
        gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, layer.stride, a.offset + runStart * layer.stride);
      }
      gl.drawArraysInstanced(mode, 0, vertices, runCount);
      runCount = 0;
    };
    for (const r of batch.ranges) {
      const visible = !(r.maxX < minX || r.minX > maxX || r.maxY < minY || r.minY > maxY);
      if (!visible) {
        flush();
        continue;
      }
      if (runCount === 0) runStart = r.start;
      runCount += r.count;
    }
    flush();
    for (const a of layer.attrs) gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, layer.stride, a.offset);
  }

  draw(f: Frame): void {
    if (this.lost) return;
    const { gl } = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.clearColor(f.grid.bg[0], f.grid.bg[1], f.grid.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!skipLayers.has('grid')) this.drawGrid(f);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const strip = gl.TRIANGLE_STRIP;
    this.drawLayer('groups', f.groups, this.box, f.camera, 4, strip);
    this.drawLayer('edges', f.edges, this.seg, f.camera, 4, strip);
    this.drawLayer('arrows', f.arrows, this.arrow, f.camera, 3, gl.TRIANGLES);
    this.drawLayer('nodes', f.nodes, this.box, f.camera, 4, strip);
    this.drawLayer('ports', f.ports, this.disc, f.camera, 4, strip);
    this.drawLayer('overlayDiscs', f.overlayDiscs, this.disc, f.camera, 4, strip);
    this.drawLayer('overlaySegs', f.overlaySegs, this.seg, f.camera, 4, strip);
    this.drawLayer('overlayBoxes', f.overlayBoxes, this.box, f.camera, 4, strip);
    gl.bindVertexArray(null);
  }

  private drawGrid(f: Frame): void {
    const { gl } = this;
    gl.useProgram(this.grid.program);
    gl.uniform2f(this.grid.u.u_translate, f.camera.x, f.camera.y);
    gl.uniform1f(this.grid.u.u_step, f.grid.step * f.camera.scale * this.dpr);
    gl.uniform1f(this.grid.u.u_dpr, this.dpr);
    gl.uniform1f(this.grid.u.u_height, this.canvas.height);
    gl.uniform4fv(this.grid.u.u_bg, f.grid.bg);
    gl.uniform4fv(this.grid.u.u_dot, f.grid.dot);
    gl.bindVertexArray(this.gridVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
