import { ArrowLeft, Copy, Play } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { benchGraph, benchPhases, frameStats, type PhaseResult } from '../../canvas/bench';
import type { CanvasEngine } from '../../canvas/engine';
import { skipLayers } from '../../canvas/gl/renderer';
import { newProject } from '../../core/project/create';
import type { ProjectData } from '../../core/project/types';
import { Store } from '../../core/store';
import { useAtom } from '../../core/useStore';
import { settings, updateSettings } from '../../state/settings';
import type { QualityName } from '../../canvas/quality';
import { t, type MessageKey } from '../../i18n';
import type { OpenProject } from '../../state/project';
import { CanvasView } from '../canvas/CanvasView';
import { Button, SelectField, toast } from '../components';
import { FULL_VERSION } from '../../core/version';
import './bench.css';

export interface BenchReport {
  nodes: number;
  edges: number;
  mode: QualityName;
  gpu: string;
  screen: string;
  phases: PhaseResult[];
  total: { fps: number; p95: number; max: number };
}

declare global {
  interface Window {
    __herplanBench?: Promise<BenchReport>;
  }
}

const PHASE_NAMES: Record<PhaseResult['id'], MessageKey> = {
  near: 'bench.phase.near',
  zoom: 'bench.phase.zoom',
  mid: 'bench.phase.mid',
  whole: 'bench.phase.whole',
};

function benchProject(nodes: number): OpenProject {
  const data = newProject({ name: 'Benchmark', appVersion: __APP_VERSION__ });
  const graph = benchGraph(nodes, Math.round(nodes * 1.6));
  data.graphs[graph.id] = graph as unknown as ProjectData['graphs'][string];
  return { dir: '', store: new Store(data), saver: null, backups: null, readOnly: true, issues: [] };
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/** Canvas benchmark (F2-14): the owner runs it on the reference laptop, CI runs it on every push. */
export function CanvasBench() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  skipLayers.clear();
  for (const layer of params.get('skip')?.split(',') ?? []) skipLayers.add(layer);
  const [nodes, setNodes] = useState(Number(params.get('nodes')) || 5000);
  const project = useMemo(() => benchProject(nodes), [nodes]);
  const engine = useRef<CanvasEngine | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<BenchReport | null>(null);
  const autoStarted = useRef(false);
  const { canvasQuality } = useAtom(settings);
  const modeName = (mode: QualityName) =>
    mode === 'normal' ? t('settings.canvasQuality.normal') : t('settings.canvasQuality.economy');

  const run = async (): Promise<BenchReport> => {
    const e = engine.current;
    if (!e) throw new Error('canvas not ready');
    setRunning(true);
    setReport(null);
    const { width, height } = e.view.get();
    const graph = project.store.getState().graphs.bench as unknown as { nodes: unknown[]; edges: unknown[] };
    const all: number[] = [];
    const phases: PhaseResult[] = [];
    for (const phase of benchPhases(e.graph, width, height)) {
      e.setCamera(phase.camera(0));
      await nextFrame();
      await nextFrame();
      const times: number[] = [];
      const start = performance.now();
      for (;;) {
        const now = await nextFrame();
        times.push(now);
        const t01 = (now - start) / (phase.seconds * 1000);
        if (t01 >= 1) break;
        e.setCamera(phase.camera(t01));
      }
      phases.push({ id: phase.id, ...frameStats(times) });
      all.push(...times);
    }
    const result: BenchReport = {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      mode: settings.get().canvasQuality,
      gpu: e.gpu,
      screen: `${screen.width}×${screen.height} @${devicePixelRatio}`,
      phases,
      total: {
        fps: Math.round((phases.reduce((s, p) => s + p.fps, 0) / phases.length) * 10) / 10,
        p95: Math.max(...phases.map((p) => p.p95)),
        max: Math.max(...phases.map((p) => p.max)),
      },
    };
    setReport(result);
    setRunning(false);
    return result;
  };

  const onEngine = (e: CanvasEngine | null) => {
    engine.current = e;
    if (e && params.get('auto') === '1' && !autoStarted.current) {
      autoStarted.current = true;
      // Give the first frames time to settle, then run; tests await window.__herplanBench.
      window.__herplanBench = new Promise((resolve) => setTimeout(resolve, 500)).then(run);
    }
  };

  const text = report && reportText(report);

  return (
    <div className="bench">
      <header className="bench-bar">
        <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => (window.location.hash = '')}>
          {t('bench.back')}
        </Button>
        <h1>{t('bench.title')}</h1>
        <SelectField
          label={t('bench.nodes')}
          value={nodes}
          options={[1000, 5000, 20000].map((n) => ({ value: n, label: String(n) }))}
          onChange={setNodes}
          disabled={running}
        />
        <SelectField
          label={t('bench.mode')}
          value={canvasQuality}
          options={(['normal', 'economy'] as const).map((m) => ({ value: m, label: modeName(m) }))}
          onChange={(mode) => updateSettings((x) => ({ ...x, canvasQuality: mode }))}
          disabled={running}
        />
        <Button variant="primary" icon={<Play size={16} />} busy={running} onClick={() => void run()}>
          {t('bench.run')}
        </Button>
        {text && (
          <Button
            icon={<Copy size={16} />}
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => toast({ kind: 'success', text: t('bench.copied') }));
            }}
          >
            {t('bench.copy')}
          </Button>
        )}
      </header>
      <div className="bench-canvas">
        <CanvasView key={nodes} project={project} graphId="bench" onEngine={onEngine} />
      </div>
      {report && (
        <table className="bench-table" data-testid="bench-report">
          <thead>
            <tr>
              <th>{t('bench.phase')}</th>
              <th>{t('bench.fps')}</th>
              <th>{t('bench.p95')}</th>
              <th>{t('bench.max')}</th>
            </tr>
          </thead>
          <tbody>
            {report.phases.map((p) => (
              <tr key={p.id}>
                <td>{t(PHASE_NAMES[p.id])}</td>
                <td>{p.fps}</td>
                <td>{p.p95}</td>
                <td>{p.max}</td>
              </tr>
            ))}
          </tbody>
          <caption>
            {t('bench.summary', {
              fps: report.total.fps,
              nodes: report.nodes,
              edges: report.edges,
              mode: modeName(report.mode),
              gpu: report.gpu,
            })}
          </caption>
        </table>
      )}
    </div>
  );
}

function reportText(r: BenchReport): string {
  return [
    `HErPlan ${FULL_VERSION} — canvas benchmark`,
    `GPU: ${r.gpu}; screen ${r.screen}; ${r.nodes} nodes, ${r.edges} edges; mode ${r.mode}`,
    '| phase | fps | p95 ms | max ms |',
    '| --- | --- | --- | --- |',
    ...r.phases.map((p) => `| ${p.id} | ${p.fps} | ${p.p95} | ${p.max} |`),
    `| total | ${r.total.fps} | ${r.total.p95} | ${r.total.max} |`,
  ].join('\n');
}
