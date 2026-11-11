// One dialogue line in the inspector (0.8): who says it, the text with the look of its words shown in the
// field itself, the row of the game's palette under it (style, face, gesture, emote), and, folded away, the
// rest the game needs: timings, the "interrupted" exit, a condition, effects, actions, a note for the
// translator, and the marks on the words (their look) and between them (pauses, sounds, gestures).

import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Paintbrush,
  Play,
  Trash,
  X,
} from 'lucide-react';
import { Fragment, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useAtom, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { gameFiles } from '../../state/gameFiles';
import type { WorldEntity } from '../../story/entities';
import { visibleLength } from '../../story/game';
import {
  addCueMark,
  addStyleMark,
  cueAt,
  removeMark,
  resolveRange,
  setMarkProps,
  textMarksOn,
  toggleBold,
} from '../../story/marks';
import {
  CUE_KINDS,
  type CueKind,
  type CueProps,
  type DialogueLine,
  type MarkAnchor,
  type StoryNode,
  type StyleProps,
  type TextMark,
} from '../../story/model';
import {
  editActions,
  moveLine,
  removeLine,
  setInterruptExit,
  setLineFields,
  storyNode,
  updateLine,
} from '../../story/ops';
import { paletteEntry, type Palette } from '../../story/palette';
import { translationsOf, type Translations } from '../../story/translation';
import { IconButton, Switch, type MenuEntry } from '../components';
import { useStory } from './context';
import { ExpressionField } from './ExpressionField';
import { ActionsEditor, NumberBlank, PaletteInput, TowardInput } from './game';
import { CUE_ICONS, CUE_NAMES, cueKind, cueText, gameMarks, styleCss } from './lineLook';
import { highlightPieces, MarkedTextArea, pieceStyle, textHighlights, useTextMenu } from './MarkedText';
import { DeviceMenu, useAddDevice } from './plotTools';
import { TypingPreview } from './TypingPreview';

const CUE_DEFAULT: Record<CueKind, CueProps> = {
  pause: { pause: 0.4 },
  shake: { shake: 1 },
  sound: { sound: '' },
  gesture: { gesture: '' },
  emote: { emote: '' },
  face: { face: '' },
};

/** The line as the game shows it: real weights and sizes, and an icon for every cue, explained on hover. */
function LinePreview({
  node,
  line,
  palette,
  nameOf,
}: {
  node: StoryNode;
  line: DialogueLine;
  palette: Palette;
  nameOf: (id: string) => string;
}) {
  const anchor: MarkAnchor = { kind: 'line', id: line.id };
  const { highlights, cues } = gameMarks(node, anchor, line.text, palette, true);
  if (!highlights.length && !cues.length) return null;
  const icons = (at: number) =>
    cues
      .filter((c) => c.at === at)
      .map((c) => {
        if (c.mark.device !== 'cue') return null;
        const Icon = CUE_ICONS[cueKind(c.mark.props)];
        const text = cueText(c.mark.props, palette, nameOf);
        return (
          <span key={c.mark.id} className="line-cue" title={text} aria-label={text} role="img">
            <Icon size={12} />
          </span>
        );
      });
  const pieces = highlightPieces(
    line.text,
    highlights,
    cues.map((c) => c.at),
  );
  return (
    <div className="line-preview" aria-label={t('line.preview')}>
      {pieces.map((p, i) => (
        <Fragment key={i}>
          {icons(p.start)}
          <span className={p.over.map((h) => h.className).join(' ') || undefined} style={pieceStyle(p.over)}>
            {p.text}
          </span>
        </Fragment>
      ))}
      {icons(line.text.length)}
    </div>
  );
}

export function LineRow({
  line,
  index,
  last,
  node,
  maxChars,
  characters,
  entities,
  readOnly,
}: {
  line: DialogueLine;
  index: number;
  last: boolean;
  node: StoryNode;
  maxChars: number;
  characters: WorldEntity[];
  entities: ProjectData['entities'];
  readOnly: boolean;
}) {
  const { edit, task } = useStory();
  const { palette, translations } = useAtom(gameFiles);
  const [previewing, setPreviewing] = useState(false);
  const nodeId = node.id;
  const anchor: MarkAnchor = { kind: 'line', id: line.id };
  const addDevice = useAddDevice(node.id);
  const marks = textMarksOn(node, anchor);
  const hasMore =
    marks.length > 0 ||
    line.auto !== undefined ||
    line.interrupt !== undefined ||
    !!line.interruptExit ||
    !!line.condition ||
    !!line.effects ||
    !!line.actions?.length ||
    !!line.note;
  const [open, setOpen] = useState(hasMore);
  const change = (recipe: (n: StoryNode) => void, mergeKey?: string) =>
    edit(
      t('story.step.lines'),
      (g) => {
        const n = storyNode(g, nodeId);
        if (n) recipe(n);
      },
      mergeKey,
    );
  const set = (patch: Partial<DialogueLine>, mergeKey?: string) =>
    edit(t('story.step.lines'), (g) => setLineFields(g, nodeId, line.id, patch), mergeKey);

  const bold = (sel: { start: number; end: number }) => change((n) => toggleBold(n, line.id, sel));
  const style = (sel: { start: number; end: number }) => {
    change((n) => void addStyleMark(n, line.id, sel, {}));
    setOpen(true);
  };
  const cue = (at: number, kind: CueKind) => {
    change((n) => void addCueMark(n, line.id, at, { ...CUE_DEFAULT[kind] }));
    if (kind !== 'pause') setOpen(true);
  };
  const menu = useTextMenu({
    readOnly,
    onDevice: (device, sel) => addDevice(device, anchor, sel),
    extra: ({ start, end, selected }): MenuEntry[] => [
      {
        id: 'bold',
        label: t('line.bold'),
        icon: <Bold size={16} />,
        shortcut: 'Ctrl+B',
        disabled: readOnly || !selected,
        onSelect: () => bold({ start, end }),
      },
      {
        id: 'style',
        label: t('line.styleWords'),
        icon: <Paintbrush size={16} />,
        shortcut: 'Ctrl+E',
        disabled: readOnly || !selected,
        onSelect: () => style({ start, end }),
      },
      ...CUE_KINDS.map((kind) => {
        const Icon = CUE_ICONS[kind];
        return {
          id: `cue-${kind}`,
          label: t('line.cueHere', { what: t(CUE_NAMES[kind]) }),
          icon: <Icon size={16} />,
          ...(kind === 'pause' ? { shortcut: 'Ctrl+P' } : {}),
          disabled: readOnly,
          onSelect: () => cue(start, kind),
        };
      }),
    ],
  });
  // Bold, pause and style from the keyboard, whatever the layout.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const el = e.currentTarget;
    const sel = { start: el.selectionStart, end: el.selectionEnd };
    if (e.code === 'KeyB' && sel.end > sel.start) bold(sel);
    else if (e.code === 'KeyE' && sel.end > sel.start) style(sel);
    else if (e.code === 'KeyP') cue(sel.start, 'pause');
    else return;
    e.preventDefault();
  };

  const chars = visibleLength(line.text);
  const unknownSpeaker = line.speaker && !entities[line.speaker];
  const nameOf = (id: string) => (entities[id]?.name as string | undefined) ?? t('story.lines.deletedSpeaker');
  const game = gameMarks(node, anchor, line.text, palette);
  const others = characters.filter((c) => c.id !== line.speaker).map((c) => ({ id: c.id, name: c.name }));
  const lineStyle = paletteEntry(palette, 'styles', line.style)?.color;
  return (
    <div className="iline" data-line={line.id} data-field={`line:${line.id}`}>
      <div className="iline-head">
        <select
          className="input iline-speaker"
          value={line.speaker ?? ''}
          disabled={readOnly}
          aria-label={t('story.lines.speaker')}
          onChange={(e) =>
            edit(t('story.step.lines'), (g) => updateLine(g, nodeId, line.id, { speaker: e.target.value || null }))
          }
        >
          <option value="">{t('story.narrator')}</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || t('story.untitled')}
            </option>
          ))}
          {unknownSpeaker && <option value={line.speaker!}>{t('story.lines.deletedSpeaker')}</option>}
        </select>
        <span
          className={['small', 'iline-count', chars > maxChars ? 'text-warning' : 'muted'].join(' ')}
          title={t('line.countHint')}
        >
          {t('story.lines.chars', { count: chars, max: maxChars })}
        </span>
        <IconButton
          size="sm"
          label={t('preview.line')}
          icon={<Play size={14} />}
          disabled={!line.text.trim()}
          onClick={() => setPreviewing(true)}
        />
        {!readOnly && (
          <span className="iline-tools">
            <IconButton
              size="sm"
              label={t('story.up')}
              icon={<ArrowUp size={14} />}
              disabled={index === 0}
              onClick={() => edit(t('story.step.lines'), (g) => moveLine(g, nodeId, index, index - 1))}
            />
            <IconButton
              size="sm"
              label={t('story.down')}
              icon={<ArrowDown size={14} />}
              disabled={last}
              onClick={() => edit(t('story.step.lines'), (g) => moveLine(g, nodeId, index, index + 1))}
            />
            <DeviceMenu onDevice={(device) => addDevice(device, anchor)} />
            <IconButton
              size="sm"
              label={t('story.lines.remove')}
              icon={<Trash size={14} />}
              onClick={() => edit(t('story.step.lines'), (g) => removeLine(g, nodeId, line.id))}
            />
          </span>
        )}
      </div>
      <MarkedTextArea
        className={['iline-text', chars > maxChars && 'iline-over'].filter(Boolean).join(' ')}
        value={line.text}
        highlights={[...textHighlights(line.text, node, anchor), ...game.highlights]}
        ticks={game.cues.map((c) => c.at)}
        live={game.highlights.length > 0 || !!lineStyle}
        mirrorStyle={lineStyle ? { color: lineStyle } : undefined}
        rows={1}
        readOnly={readOnly}
        aria-label={t('story.lines.text', { n: index + 1 })}
        onContextMenu={menu.onContextMenu}
        onKeyDown={onKeyDown}
        onChange={(e) =>
          edit(
            t('story.step.lines'),
            (g) => updateLine(g, nodeId, line.id, { text: e.target.value }),
            `line:${line.id}`,
          )
        }
      />
      {menu.menu}
      <Translation translations={translations} id={line.id} edited={(line as { edited?: string }).edited} />
      <LinePreview node={node} line={line} palette={palette} nameOf={nameOf} />
      {previewing && (
        <TypingPreview node={node} start={index} only entities={entities} onClose={() => setPreviewing(false)} />
      )}
      <div className="iline-game">
        <PaletteInput
          palette={palette}
          list="styles"
          value={line.style}
          label={t('line.style')}
          disabled={readOnly}
          onChange={(v) => set({ style: v }, `style:${line.id}`)}
        />
        <PaletteInput
          palette={palette}
          list="faces"
          value={line.face}
          label={t('line.face')}
          disabled={readOnly}
          onChange={(v) => set({ face: v }, `face:${line.id}`)}
        />
        <TowardInput
          palette={palette}
          list="gestures"
          value={line.gesture}
          label={t('line.gesture')}
          people={others}
          disabled={readOnly}
          onChange={(v) => set({ gesture: v }, `gesture:${line.id}`)}
        />
        <TowardInput
          palette={palette}
          list="emotes"
          value={line.emote}
          label={t('line.emote')}
          people={others}
          disabled={readOnly}
          onChange={(v) => set({ emote: v }, `emote:${line.id}`)}
        />
      </div>
      <button type="button" className="iline-more" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t('line.more')}</span>
        {!open && hasMore && <span className="iline-more-dot" aria-label={t('line.moreSet')} />}
      </button>
      {open && (
        <div className="iline-details">
          {marks.length > 0 && (
            <div className="tmarks" aria-label={t('line.marks')}>
              {marks.map((m) => (
                <TextMarkRow
                  key={m.id}
                  mark={m}
                  text={line.text}
                  palette={palette}
                  people={others}
                  readOnly={readOnly}
                  onProps={(props) => change((n) => setMarkProps(n, m.id, props), `tmark:${m.id}`)}
                  onRemove={() => change((n) => removeMark(n, m.id))}
                />
              ))}
            </div>
          )}
          <p className="muted small">{t('line.marksHint')}</p>
          <div className="iline-times">
            <NumberBlank
              label={t('line.auto')}
              value={line.auto}
              placeholder={t('line.autoBlank')}
              disabled={readOnly}
              onChange={(auto) => set({ auto }, `auto:${line.id}`)}
            />
            <NumberBlank
              label={t('line.interrupt')}
              value={line.interrupt}
              placeholder={t('line.interruptBlank')}
              disabled={readOnly}
              onChange={(interrupt) => {
                // Zero is a value here ("cannot be interrupted"), not "not set".
                edit(
                  t('story.step.lines'),
                  (g) => {
                    const l = storyNode(g, nodeId)?.lines?.find((x) => x.id === line.id);
                    if (!l) return;
                    if (interrupt === undefined) delete l.interrupt;
                    else l.interrupt = interrupt;
                  },
                  `interrupt:${line.id}`,
                );
              }}
            />
          </div>
          {node.when === undefined && (
            <Switch
              label={t('line.interruptExit')}
              checked={line.interruptExit === true}
              disabled={readOnly}
              onChange={(on) => edit(t('story.step.lines'), (g) => setInterruptExit(g, nodeId, line.id, on))}
            />
          )}
          <ExpressionField
            label={t('line.condition')}
            kind="condition"
            field={`line:${line.id}:condition`}
            value={line.condition ?? ''}
            readOnly={readOnly}
            onChange={(condition) => set({ condition }, `lcond:${line.id}`)}
          />
          <ExpressionField
            label={t('line.effects')}
            kind="effects"
            field={`line:${line.id}:effects`}
            value={line.effects ?? ''}
            readOnly={readOnly}
            onChange={(effects) => set({ effects }, `leff:${line.id}`)}
          />
          <LineActions line={line} nodeId={nodeId} readOnly={readOnly} />
          <label className="field">
            <span className="field-label">{t('line.note')}</span>
            <textarea
              className="input textarea iline-note"
              rows={1}
              value={line.note ?? ''}
              disabled={readOnly}
              placeholder={t('line.notePlaceholder')}
              onChange={(e) => set({ note: e.target.value }, `lnote:${line.id}`)}
            />
          </label>
          <button type="button" className="entity-link small" onClick={() => task({ node: nodeId, line: line.id })}>
            <ClipboardCopy size={12} /> {t('task.line')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The line in the game's other languages (0.8, item 20 of "Dialogues"): read-only, from the game's file;
 * marked when the line was changed after it was translated.
 */
export function Translation({ translations, id, edited }: { translations: Translations; id: string; edited?: string }) {
  const found = translationsOf(translations, id, edited);
  if (!found.length) return null;
  return (
    <div className="translation" aria-label={t('translation.label')}>
      {found.map((x) => (
        <div key={x.lang} className={['translation-row', x.stale && 'translation-stale'].filter(Boolean).join(' ')}>
          <span className="translation-lang" title={t('translation.hint')}>
            {x.lang.toUpperCase()}
          </span>
          <span className="translation-text">{x.text || '…'}</span>
          {x.stale && <span className="small text-warning">{t('translation.stale')}</span>}
        </div>
      ))}
    </div>
  );
}

function LineActions({ line, nodeId, readOnly }: { line: DialogueLine; nodeId: string; readOnly: boolean }) {
  const { project, edit } = useStory();
  const data = useStore(project.store, (s) => s);
  return (
    <div className="field">
      <span className="field-label">{t('action.title')}</span>
      <ActionsEditor
        actions={line.actions}
        data={data}
        disabled={readOnly}
        field={`line:${line.id}:actions`}
        onChange={(actions) =>
          edit(t('action.step'), (g) => {
            const l = storyNode(g, nodeId)?.lines?.find((x) => x.id === line.id);
            if (l) editActions(l, (list) => list.splice(0, list.length, ...actions));
          })
        }
      />
    </div>
  );
}

/** One mark of the game on a line: the look of words, or a cue between them. */
function TextMarkRow({
  mark: m,
  text,
  palette,
  people,
  readOnly,
  onProps,
  onRemove,
}: {
  mark: TextMark;
  text: string;
  palette: Palette;
  people: { id: string; name: string }[];
  readOnly: boolean;
  onProps: (props: StyleProps | CueProps) => void;
  onRemove: () => void;
}) {
  const remove = !readOnly && (
    <IconButton size="sm" label={t('line.markRemove')} icon={<X size={14} />} onClick={onRemove} />
  );
  if (m.device === 'style') {
    const r = resolveRange(text, m.range);
    const p = m.props;
    const put = (patch: Partial<StyleProps>) => {
      const next: StyleProps = { ...p, ...patch };
      for (const k of Object.keys(next) as (keyof StyleProps)[]) {
        if (next[k] === '' || next[k] === undefined || next[k] === false) delete next[k];
      }
      onProps(next);
    };
    return (
      <div className="tmark tmark-style" data-field={`tmark:${m.id}`}>
        <div className="tmark-head">
          <Paintbrush size={13} aria-hidden="true" />
          <span className="tmark-quote" style={styleCss(p, palette, true)}>
            «{r ? text.slice(r.start, r.end) : (m.range?.quote ?? '')}»
          </span>
          {remove}
        </div>
        <div className="tmark-props">
          <PaletteInput
            palette={palette}
            list="styles"
            value={p.style}
            label={t('line.style')}
            disabled={readOnly}
            onChange={(style) => put({ style })}
          />
          <PaletteInput
            palette={palette}
            list="sizes"
            value={p.size}
            label={t('mark.size')}
            disabled={readOnly}
            onChange={(size) => put({ size })}
          />
          <PaletteInput
            palette={palette}
            list="effects"
            value={p.effect}
            label={t('mark.effect')}
            disabled={readOnly}
            onChange={(effect) => put({ effect })}
          />
          <PaletteInput
            palette={palette}
            list="reveals"
            value={p.reveal}
            label={t('mark.reveal')}
            disabled={readOnly}
            onChange={(reveal) => put({ reveal })}
          />
          <NumberBlank
            label={t('mark.speed')}
            value={p.speed}
            min={0.1}
            placeholder="1"
            disabled={readOnly}
            onChange={(speed) => put({ speed })}
          />
          <label className="tmark-check">
            <input
              type="checkbox"
              checked={p.bold === true}
              disabled={readOnly}
              onChange={(e) => put({ bold: e.target.checked })}
            />
            <span>{t('line.bold')}</span>
          </label>
          <span className="tmark-color">
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(p.color ?? '') ? p.color : '#ffffff'}
              disabled={readOnly}
              aria-label={t('mark.color')}
              title={t('mark.color')}
              onChange={(e) => put({ color: e.target.value })}
            />
            {p.color && !readOnly && (
              <IconButton
                size="sm"
                label={t('mark.colorNone')}
                icon={<X size={12} />}
                onClick={() => put({ color: undefined })}
              />
            )}
          </span>
        </div>
      </div>
    );
  }
  const kind = cueKind(m.props);
  const Icon = CUE_ICONS[kind];
  const at = cueAt(text, m);
  const before = text.slice(Math.max(0, at - 14), at).trimStart();
  let value: ReactNode;
  if (kind === 'pause' || kind === 'shake') {
    value = (
      <NumberBlank
        label={t(kind === 'pause' ? 'cue.seconds' : 'cue.strength')}
        value={m.props[kind]}
        disabled={readOnly}
        onChange={(n) => onProps({ [kind]: n ?? 0 })}
      />
    );
  } else if (kind === 'sound' || kind === 'face') {
    value = (
      <PaletteInput
        palette={palette}
        list={kind === 'sound' ? 'sounds' : 'faces'}
        value={m.props[kind]}
        label={t(CUE_NAMES[kind])}
        disabled={readOnly}
        onChange={(id) => onProps({ [kind]: id })}
      />
    );
  } else {
    value = (
      <TowardInput
        palette={palette}
        list={kind === 'gesture' ? 'gestures' : 'emotes'}
        value={m.props[kind]}
        label={t(CUE_NAMES[kind])}
        people={people}
        disabled={readOnly}
        onChange={(v) => onProps({ [kind]: v ?? '' })}
      />
    );
  }
  return (
    <div className="tmark tmark-cue" data-field={`tmark:${m.id}`}>
      <div className="tmark-head">
        <Icon size={13} aria-hidden="true" />
        <span className="tmark-where muted small">
          {at === 0 ? t('cue.atStart') : t('cue.after', { text: before })}
        </span>
        {remove}
      </div>
      <div className="tmark-props">
        <select
          className="input"
          value={kind}
          disabled={readOnly}
          aria-label={t('cue.kind')}
          onChange={(e) => onProps({ ...CUE_DEFAULT[e.target.value as CueKind] })}
        >
          {CUE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(CUE_NAMES[k])}
            </option>
          ))}
        </select>
        {value}
      </div>
    </div>
  );
}
