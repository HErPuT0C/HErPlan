// The tour (0.7, F7-10): a dimmed window with one part of the interface lit, and a card that says what it is
// for. Each step can open a module first (the documents, the tasks…); Enter or → goes on, ← back, Escape
// ends it. The steps work on any project; the tutorial project gives them something to show.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAtom } from '../../core/useStore';
import { listDocuments } from '../../documents/model';
import { t, type MessageKey } from '../../i18n';
import { openDocument, openEntity, openModule } from '../../state/navigation';
import { currentProject, type OpenProject } from '../../state/project';
import { endTour, tour, tourStep } from '../../state/tour';
import type { ModuleKind } from '../../state/workspace';
import { listEntities } from '../../story/entities';
import { Button } from '../components';
import './tour.css';

interface TourStep {
  id: string;
  title: MessageKey;
  text: MessageKey;
  /** `data-tour` of what is lit; none — the card in the middle. */
  target?: string;
  /** The module to bring to the front first. */
  module?: ModuleKind;
  /** Something to show in the module (a document open, a card selected). */
  prepare?: (project: OpenProject) => void;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', title: 'tour.welcome.title', text: 'tour.welcome.text' },
  { id: 'save', title: 'tour.save.title', text: 'tour.save.text', target: 'save' },
  { id: 'tabs', title: 'tour.tabs.title', text: 'tour.tabs.text', target: 'tabs' },
  { id: 'story', title: 'tour.story.title', text: 'tour.story.text', target: 'canvas', module: 'story' },
  { id: 'play', title: 'tour.play.title', text: 'tour.play.text', target: 'play', module: 'story' },
  { id: 'checks', title: 'tour.checks.title', text: 'tour.checks.text', target: 'checks', module: 'story' },
  { id: 'variables', title: 'tour.variables.title', text: 'tour.variables.text', target: 'variables' },
  {
    id: 'world',
    title: 'tour.world.title',
    text: 'tour.world.text',
    target: 'world',
    module: 'database',
    prepare: (project) => {
      const first = listEntities(project.store.getState())[0];
      if (first) openEntity(first.id);
    },
  },
  {
    id: 'docs',
    title: 'tour.docs.title',
    text: 'tour.docs.text',
    target: 'docs',
    module: 'documents',
    prepare: (project) => {
      const docs = listDocuments(project.store.getState());
      const first = docs.find((d) => !d.path.includes('/')) ?? docs[0];
      if (first) openDocument(first.id);
    },
  },
  { id: 'tasks', title: 'tour.tasks.title', text: 'tour.tasks.text', target: 'tasks', module: 'tasks' },
  { id: 'map', title: 'tour.map.title', text: 'tour.map.text', target: 'map', module: 'map' },
  { id: 'assets', title: 'tour.assets.title', text: 'tour.assets.text', target: 'assets', module: 'assets' },
  { id: 'search', title: 'tour.search.title', text: 'tour.search.text', target: 'search' },
  { id: 'history', title: 'tour.history.title', text: 'tour.history.text', target: 'history' },
  { id: 'export', title: 'tour.export.title', text: 'tour.export.text', target: 'export' },
  { id: 'settings', title: 'tour.settings.title', text: 'tour.settings.text', target: 'settings' },
  { id: 'finish', title: 'tour.finish.title', text: 'tour.finish.text' },
];

/** Shown while a tour runs and a project is open. */
export function Tour() {
  const state = useAtom(tour);
  const project = useAtom(currentProject);
  // The project closed in the middle of the tour: the tour ends with it.
  useEffect(() => {
    if (state && !project) endTour();
  }, [state, project]);
  if (!state || !project) return null;
  return <TourCard key={state.step} project={project} index={Math.min(state.step, TOUR_STEPS.length - 1)} />;
}

const PAD = 6;
const MARGIN = 12;

function TourCard({ project, index }: { project: OpenProject; index: number }) {
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;
  // On the designer's own project the first and the last words do not speak of the tutorial project.
  const own = project.store.getState().meta.tutorial !== true;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);

  // Open the module, then follow the lit element (it may appear a moment later and move as the layout settles).
  useEffect(() => {
    if (step.module) openModule(step.module);
    const prepared = setTimeout(() => step.prepare?.(project), 60);
    let frame = 0;
    let lastBox = '';
    const started = performance.now();
    const follow = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      const r = el?.getBoundingClientRect() ?? null;
      const visible = r && r.width > 0 && r.height > 0 ? r : null;
      const box = visible ? `${visible.left},${visible.top},${visible.width},${visible.height}` : '';
      if (box !== lastBox) {
        lastBox = box;
        setRect(visible);
      }
      // A target that never shows up (switched off in the settings): the card stays in the middle.
      if (step.target && !visible && performance.now() - started > 2000) return;
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      clearTimeout(prepared);
      cancelAnimationFrame(frame);
    };
  }, [step, project]);

  // The card next to what is lit: below it, above it, at a side, or in the middle.
  useLayoutEffect(() => {
    const c = card.current;
    if (!c) return;
    const { width, height } = c.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - width - MARGIN));
    const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - height - MARGIN));
    if (!rect) {
      setPos({ left: (vw - width) / 2, top: Math.max(MARGIN, (vh - height) / 2) });
      return;
    }
    // A whole module lit: the card goes into the corner, out of the way.
    if (rect.width * rect.height > vw * vh * 0.4) {
      setPos({ left: vw - width - MARGIN * 2, top: vh - height - MARGIN * 2 });
      return;
    }
    const below = rect.bottom + PAD + MARGIN;
    const above = rect.top - PAD - MARGIN - height;
    if (below + height <= vh - MARGIN) setPos({ left: clampX(rect.left), top: below });
    else if (above >= MARGIN) setPos({ left: clampX(rect.left), top: above });
    else if (rect.right + MARGIN + width <= vw - MARGIN) setPos({ left: rect.right + MARGIN, top: clampY(rect.top) });
    else if (rect.left - MARGIN - width >= MARGIN) setPos({ left: rect.left - MARGIN - width, top: clampY(rect.top) });
    else setPos({ left: (vw - width) / 2, top: clampY(rect.bottom - height - MARGIN) });
  }, [rect]);

  useEffect(() => card.current?.querySelector<HTMLButtonElement>('.tour-next')?.focus(), []);

  // The tour's own keys come first: the application's shortcuts wait until it ends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys: Record<string, () => void> = {
        Escape: endTour,
        ArrowRight: () => (last ? endTour() : tourStep(index + 1)),
        ArrowLeft: () => index > 0 && tourStep(index - 1),
      };
      const run = keys[e.key];
      if (!run) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, last]);

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text">
      {rect ? (
        <div
          className="tour-spot"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        ref={card}
        className="tour-card"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
        data-tour-step={step.id}
      >
        <div className="tour-progress muted small">
          {t('tour.progress', { n: index + 1, total: TOUR_STEPS.length })}
        </div>
        <h2 id="tour-title" className="tour-title">
          {t(step.title)}
        </h2>
        <p id="tour-text" className="tour-text">
          {t(own && step.id === 'welcome' ? 'tour.welcome.textOwn' : own && last ? 'tour.finish.textOwn' : step.text)}
        </p>
        <footer className="tour-actions">
          {!last && (
            <button type="button" className="tour-skip" onClick={endTour}>
              {t('tour.skip')}
            </button>
          )}
          {index > 0 && (
            <Button size="sm" variant="ghost" onClick={() => tourStep(index - 1)}>
              {t('tour.back')}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            className="tour-next"
            onClick={() => (last ? endTour() : tourStep(index + 1))}
          >
            {last ? t('tour.done') : t('tour.next')}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
