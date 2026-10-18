export interface SystemInfo {
  shell: string;
  userAgent: string;
  cpuThreads: number;
  memoryGb: number | null;
  screen: string;
  dpr: number;
  gpu: string;
}

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'WebGL недоступен';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  } catch {
    return 'неизвестно';
  }
}

export function systemInfo(shell: string): SystemInfo {
  return {
    shell,
    userAgent: navigator.userAgent,
    cpuThreads: navigator.hardwareConcurrency || 0,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    screen: `${screen.width}×${screen.height}`,
    dpr: window.devicePixelRatio || 1,
    gpu: gpuName(),
  };
}
