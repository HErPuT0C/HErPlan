// One dialogue line, in the window of a line (since 0.8.3 the only place it is edited). 0.8: who says it, the text with the look of its words shown in the
// field itself, the row of what holds from the start of the line (style, face, gesture, emote) and, folded
// away, timings, the "interrupted" exit, a condition, effects, actions, a note for the translator, and the
// marks on the words and between them. 0.8.1 ("Редактор реплик" 2–3): every value is picked from the game's
// palette; who speaks are the cards with a name in the game and the narrator, and a line nobody speaks is
// marked; a cue stands only inside the text — at its start the fields under the text are what is set.

import {
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Eraser,
  MapPinPlus,
  Paintbrush,
  Palette as PaletteIcon,
  Trash,
  X,
} from 'lucide-react';
import { Fragment, useRef, useState, type KeyboardEvent } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useAtom, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { gameFiles } from '../../state/gameFiles';
import { visibleLength } from '../../story/game';
import { keyOf } from '../../story/gameKey';
import {
  addCueMark,
  addStyleMark,
  clearLooks,
  cueAt,
  marksOn,
  moveCue,
  removeMark,
  resolveRange,
  setMarkProps,
  startCue,
  textMarksOn,
  toggleBold,
} from '../../story/marks';
import {
  CUE_KINDS,
  toward,
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
import { NARRATOR, paletteName, paletteSpeaker, type Palette } from '../../story/palette';
import { translationsOf, type Translations } from '../../story/translation';
import { IconButton, Menu, Switch, toast, type MenuEntry } from '../components';
import { PromptDialog, type PromptRequest } from '../canvas/PromptDialog';
import { useStory } from './context';
import { ExpressionField } from './ExpressionField';
import { ActionsEditor, NumberBlank, PaletteInput, TowardInput } from './game';
import { CUE_ICONS, CUE_NAMES, cueKind, cueText, gameMarks, speakerName, styleCss } from './lineLook';
import { highlightPieces, MarkedTextArea, pieceStyle, textHighlights, useTextMenu } from './MarkedText';
import { faceItems, listItems, speakerItems } from './paletteItems';
import { PaletteSelect, SoundButton } from './PaletteSelect';
import { DeviceMenu, useAddDevice } from './plotTools';
import { GameTextField } from './GameTextField';
import { useGameFont } from './gameAssets';
import { ButterflyIcon, GunIcon } from '../canvas/kindIcons';
import { gameLine } from '../../story/gameLine';

/** A pause put with Ctrl+P (the spec: 0.3 s). */
const PAUSE = 0.3;
/** Cues that at the very start of a line are the line's own fields. */
const FIELDS: readonly CueKind[] = ['face', 'gesture', 'emote'];
const FIELD_LIST = { face: 'faces', gesture: 'gestures', emote: 'emotes', sound: 'sounds' } as const;
/** How many times faster a piece of a line is typed, offered over a selection. */
const SPEEDS = [0.5, 0.75, 1.5, 2];
// Remembered while the application runs: how big the field is and whether its effects move.
let lastFieldScale = 3;
let lastMoving = true;

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

interface MenuAt {
  x: number;
  y: number;
  entries: MenuEntry[];
  label: string;
}

export function LineRow({
  line,
  index,
  last,
  node,
  maxChars,
  entities,
  people,
  readOnly,
}: {
  line: DialogueLine;
  index: number;
  last: boolean;
  node: StoryNode;
  maxChars: number;
  entities: ProjectData['entities'];
  /** Who speaks in this conversation: whom an emote, a gesture or a face can belong to. */
  people: string[];
  readOnly: boolean;
}) {
  const { project, edit, task } = useStory();
  const { palette, translations, dir } = useAtom(gameFiles);
  const font = useGameFont(dir, palette.preview?.font);
  const [fieldScale, setFieldScale] = useState(lastFieldScale);
  const [moving, setMoving] = useState(lastMoving);
  const types = useStore(project.store, (s) => s.types);
  const noPalette = !palette.loaded;
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  /** A field under the text asked to open its list (a cue at the start of the line). */
  const [openField, setOpenField] = useState<CueKind | null>(null);
  const textBox = useRef<HTMLTextAreaElement | null>(null);
  /** Where the caret was last: "+ mark" puts the mark there. */
  const caret = useRef(0);
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
  const [open, setOpen] = useState(true);
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
  const nameOf = (id: string) => speakerName(entities, id);
  const others = people.filter((p) => p !== line.speaker);
  const faces = faceItems(palette, entities, line.speaker);

  /** A value typed by hand when there is no palette (or a list the palette has not got). */
  const ask = (title: string, onSubmit: (v: string) => void) =>
    setPrompt({ title, label: t('line.valueId'), value: '', onSubmit: (v) => v.trim() && onSubmit(v.trim()) });

  const bold = (sel: { start: number; end: number }) => change((n) => toggleBold(n, line.id, sel));
  const styleWords = (sel: { start: number; end: number }, style: string) => {
    change((n) => void addStyleMark(n, line.id, sel, { style }));
    setOpen(true);
  };
  /** "Style the words…": the palette's styles in their colours. */
  const styleMenu = (sel: { start: number; end: number }, x: number, y: number) => {
    if (noPalette || !palette.styles.length) return ask(t('line.styleWords'), (v) => styleWords(sel, v));
    setMenuAt({
      x,
      y,
      label: t('line.styleWords'),
      entries: palette.styles.map((s, i) => ({
        id: s.id,
        label: s.name,
        icon: <span className="palette-dot" style={{ background: s.color ?? 'currentColor' }} />,
        shortcut: i < 8 ? `Ctrl+${i + 1}` : undefined,
        onSelect: () => styleWords(sel, s.id),
      })),
    });
  };

  /** Puts a cue of a kind at a place of the text, asking for its value first when it has one. */
  const putCue = (kind: CueKind, at: number, x: number, y: number) => {
    if (at <= 0) {
      // What holds from the start of the line is set in its fields.
      if (FIELDS.includes(kind)) {
        setOpenField(kind);
        return;
      }
      toast({ kind: 'info', text: t('line.noStartCue') });
      return;
    }
    if (kind === 'pause') return change((n) => void addCueMark(n, line.id, at, { pause: PAUSE }));
    if (kind === 'shake') return change((n) => void addCueMark(n, line.id, at, { shake: 1 }));
    const put = (value: string) => {
      change((n) => void addCueMark(n, line.id, at, { [kind]: value } as CueProps));
      setOpen(true);
    };
    const items = kind === 'face' ? faces.items : listItems(palette, FIELD_LIST[kind]);
    if (noPalette || !items.length) {
      if (kind === 'face' && faces.gray && !noPalette) return toast({ kind: 'info', text: faces.gray });
      return ask(t(CUE_NAMES[kind]), put);
    }
    setMenuAt({
      x,
      y,
      label: t('line.cueHere', { what: t(CUE_NAMES[kind]) }),
      entries: items.map((it) => ({ id: it.id, label: it.name, icon: it.icon, onSelect: () => put(it.id) })),
    });
  };
  /** "+ mark": the kinds of cues, at the caret. */
  const cueMenu = (at: number, x: number, y: number) =>
    setMenuAt({
      x,
      y,
      label: t('line.addCue'),
      entries: CUE_KINDS.map((kind) => {
        const Icon = CUE_ICONS[kind];
        const start = at <= 0;
        return {
          id: `cue-${kind}`,
          label:
            start && FIELDS.includes(kind) ? t('line.fromStart', { what: t(CUE_NAMES[kind]) }) : t(CUE_NAMES[kind]),
          icon: <Icon size={16} />,
          shortcut: kind === 'pause' ? 'Ctrl+P' : undefined,
          disabled: readOnly || (start && !FIELDS.includes(kind)),
          onSelect: () => putCue(kind, at, x, y),
        };
      }),
    });

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
        onSelect: () => {
          const r = textBox.current?.getBoundingClientRect();
          styleMenu({ start, end }, r?.left ?? 0, (r?.bottom ?? 0) + 4);
        },
      },
      {
        id: 'cue',
        label: start > 0 ? t('line.addCue') : t('line.addCueStart'),
        icon: <MapPinPlus size={16} />,
        shortcut: 'Ctrl+M',
        disabled: readOnly,
        onSelect: () => {
          const r = textBox.current?.getBoundingClientRect();
          cueMenu(start, r?.left ?? 0, (r?.bottom ?? 0) + 4);
        },
      },
    ],
  });
  // Bold, a pause, styles and "+ mark" from the keyboard, whatever the layout.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const el = e.currentTarget;
    const sel = { start: el.selectionStart, end: el.selectionEnd };
    const r = el.getBoundingClientRect();
    const digit = /^Digit([1-8])$/.exec(e.code);
    if (e.code === 'KeyB' && sel.end > sel.start) bold(sel);
    else if (e.code === 'KeyE' && sel.end > sel.start) styleMenu(sel, r.left, r.bottom + 4);
    else if (digit && sel.end > sel.start && palette.styles[Number(digit[1]) - 1]) {
      styleWords(sel, palette.styles[Number(digit[1]) - 1].id);
    } else if (e.code === 'KeyP') {
      if (sel.start > 0) change((n) => void addCueMark(n, line.id, sel.start, { pause: PAUSE }));
      else toast({ kind: 'info', text: t('line.noStartCue') });
    } else if (e.code === 'KeyM') cueMenu(sel.start, r.left, r.bottom + 4);
    else return;
    e.preventDefault();
  };

  // ---------- the field in the game's font (0.8.3) ----------
  /** One of a list of the palette for a selection (size, effect, appearance): a menu, or typed by hand. */
  const pickFor = (
    sel: { start: number; end: number },
    list: 'sizes' | 'effects' | 'reveals',
    prop: 'size' | 'effect' | 'reveal',
    label: string,
    x: number,
    y: number,
  ) => {
    const put = (v: string) => change((n) => void addStyleMark(n, line.id, sel, { [prop]: v }));
    if (noPalette || !palette[list].length) return ask(label, put);
    setMenuAt({
      x,
      y,
      label,
      entries: listItems(palette, list).map((it) => ({
        id: it.id,
        label: it.name,
        icon: it.icon,
        onSelect: () => put(it.id),
      })),
    });
  };
  const below = (e: { currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [r.left, r.bottom + 4] as const;
  };
  const colorInput = useRef<HTMLInputElement>(null);
  const colorFor = useRef<{ start: number; end: number } | null>(null);
  /** What floats over the selected words: how they look, and the plot devices (the owner's 0.8.3). */
  const toolbar = (sel: { start: number; end: number }) => (
    <>
      <button
        type="button"
        onClick={(e) => styleMenu(sel, ...below(e))}
        title={t('line.styleWords')}
        aria-label={t('line.style')}
      >
        <Paintbrush size={13} aria-hidden="true" /> {t('line.style')} ▾
      </button>
      <button
        type="button"
        title={t('mark.color')}
        aria-label={t('mark.color')}
        onClick={() => {
          colorFor.current = sel;
          colorInput.current?.click();
        }}
      >
        <PaletteIcon size={13} aria-hidden="true" />
      </button>
      <button type="button" title={`${t('line.bold')} (Ctrl+B)`} aria-label={t('line.bold')} onClick={() => bold(sel)}>
        <Bold size={13} aria-hidden="true" />
      </button>
      <button type="button" onClick={(e) => pickFor(sel, 'sizes', 'size', t('mark.size'), ...below(e))}>
        {t('mark.size')} ▾
      </button>
      <button type="button" onClick={(e) => pickFor(sel, 'effects', 'effect', t('mark.effect'), ...below(e))}>
        {t('mark.effect')} ▾
      </button>
      <button
        type="button"
        onClick={(e) =>
          setMenuAt({
            x: below(e)[0],
            y: below(e)[1],
            label: t('mark.speed'),
            entries: SPEEDS.map((v) => ({
              id: String(v),
              label: t('preview.speedX', { n: String(v).replace('.', ',') }),
              onSelect: () => change((n) => void addStyleMark(n, line.id, sel, { speed: v })),
            })),
          })
        }
      >
        {t('mark.speed')} ▾
      </button>
      <button type="button" onClick={(e) => pickFor(sel, 'reveals', 'reveal', t('mark.reveal'), ...below(e))}>
        {t('mark.reveal')} ▾
      </button>
      <span className="gfield-sep" />
      <button
        type="button"
        onClick={(e) =>
          setMenuAt({
            x: below(e)[0],
            y: below(e)[1],
            label: t('field.device'),
            entries: [
              {
                id: 'gun',
                label: t('plot.gun'),
                icon: <GunIcon size={16} />,
                onSelect: () => addDevice('gun', anchor, sel),
              },
              {
                id: 'butterfly',
                label: t('plot.butterfly'),
                icon: <ButterflyIcon size={16} />,
                onSelect: () => addDevice('butterfly', anchor, sel),
              },
            ],
          })
        }
      >
        <GunIcon size={13} /> {t('field.device')} ▾
      </button>
      <span className="gfield-sep" />
      <button
        type="button"
        title={t('field.clear')}
        aria-label={t('field.clear')}
        onClick={() => change((n) => clearLooks(n, line.id, sel))}
      >
        <Eraser size={13} aria-hidden="true" />
      </button>
    </>
  );
  /** A click on a cue in the field: its values to pick, or away. */
  const cueClick = (id: string, x: number, y: number) => {
    const m = marks.find((k) => k.id === id);
    if (!m || m.device !== 'cue') return;
    const kind = cueKind(m.props);
    const setTo = (props: CueProps) => change((n) => setMarkProps(n, id, props), `tmark:${id}`);
    const remove: MenuEntry = {
      id: 'remove',
      label: t('line.markRemove'),
      icon: <X size={16} />,
      onSelect: () => change((n) => removeMark(n, id)),
    };
    let entries: MenuEntry[];
    if (kind === 'pause' || kind === 'shake') {
      const values = kind === 'pause' ? [0.15, 0.3, 0.5, 1] : [1, 2, 3];
      entries = [
        ...values.map((v) => ({
          id: String(v),
          label: kind === 'pause' ? t('field.seconds', { n: String(v).replace('.', ',') }) : String(v),
          onSelect: () => setTo({ [kind]: v }),
        })),
        {
          id: 'other',
          label: t('field.other'),
          onSelect: () =>
            setPrompt({
              title: t(CUE_NAMES[kind]),
              label: t(kind === 'pause' ? 'cue.seconds' : 'cue.strength'),
              value: String(m.props[kind] ?? ''),
              onSubmit: (v) => {
                const num = Number(v.replace(',', '.'));
                if (Number.isFinite(num) && num > 0) setTo({ [kind]: num });
              },
            }),
        },
      ];
    } else {
      const was = kind === 'sound' ? null : toward(m.props[kind]);
      const items =
        kind === 'face'
          ? faceItems(palette, entities, was?.to ?? line.speaker).items
          : listItems(palette, FIELD_LIST[kind]);
      entries = items.map((it) => ({
        id: it.id,
        label: it.name,
        icon: it.icon,
        onSelect: () => setTo({ [kind]: was?.to ? { id: it.id, to: was.to } : it.id } as CueProps),
      }));
    }
    setMenuAt({ x, y, label: t(CUE_NAMES[kind]), entries: [...entries, { id: 'sep', separator: true }, remove] });
  };

  const chars = visibleLength(line.text);
  const card = line.speaker && line.speaker !== NARRATOR ? entities[line.speaker] : undefined;
  const gameSpeaker = paletteSpeaker(palette, line.speaker === NARRATOR ? NARRATOR : keyOf(card));
  const game = gameMarks(node, anchor, line.text, palette);
  const lineStyle = palette.styles.find((s) => s.id === line.style)?.color;
  // In the window of a line, with the game's font in the project, the text is edited in it (0.8.3).
  const inGameFont = !!font && !!palette.preview;
  const fieldLine = inGameFont ? gameLine(line.text, line.style, marks, palette.preview) : null;
  const plotRanges = marksOn(node, anchor).flatMap((m) => {
    const r = resolveRange(line.text, m.range);
    return r ? [{ ...r, device: m.device }] : [];
  });
  const fieldCues = marks.flatMap((m) =>
    m.device === 'cue'
      ? [{ id: m.id, at: cueAt(line.text, m), props: m.props, label: cueText(m.props, palette, nameOf) }]
      : [],
  );
  const unknownSpeaker = line.speaker
    ? line.speaker === NARRATOR
      ? undefined
      : !card
        ? t('story.lines.deletedSpeaker')
        : t('line.speakerNoKey')
    : undefined;
  return (
    <div
      className={['iline', !line.speaker && 'iline-nobody'].filter(Boolean).join(' ')}
      data-line={line.id}
      data-field={`line:${line.id}`}
      style={gameSpeaker?.color ? { borderLeftColor: gameSpeaker.color } : undefined}
    >
      <div className="iline-head">
        <PaletteSelect
          label={t('line.whoSpeaks')}
          value={line.speaker}
          items={speakerItems(palette, { entities, types })}
          noneLabel={t('line.nobody')}
          unknownHint={unknownSpeaker}
          disabled={readOnly}
          className={['iline-speaker', !line.speaker && 'palette-unknown'].filter(Boolean).join(' ')}
          onChange={(v) => edit(t('story.step.lines'), (g) => updateLine(g, nodeId, line.id, { speaker: v || null }))}
        />
        <span
          className={['small', 'iline-count', chars > maxChars ? 'text-warning' : 'muted'].join(' ')}
          title={t('line.countHint')}
        >
          {t('story.lines.chars', { count: chars, max: maxChars })}
        </span>
        {!readOnly && (
          <span className="iline-tools">
            <IconButton
              size="sm"
              label={t('line.addCueKeys')}
              icon={<MapPinPlus size={14} />}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                cueMenu(caret.current, r.left, r.bottom + 4);
              }}
            />
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
      {!line.speaker && <span className="iline-who-missing">{t('line.whoSpeaksMissing')}</span>}
      {gameSpeaker && (
        <div className="iline-game-speaker small muted">
          <span className="palette-dot" style={{ background: gameSpeaker.color ?? 'currentColor' }} />
          {[
            gameSpeaker.bubble && t('line.bubbleIs', { name: paletteName(palette, 'bubbles', gameSpeaker.bubble) }),
            gameSpeaker.voice && t('line.voiceIs', { name: paletteName(palette, 'voices', gameSpeaker.voice) }),
          ]
            .filter(Boolean)
            .join(' · ')}
          <SoundButton
            sound={palette.voices.find((v) => v.id === gameSpeaker.voice)?.sound}
            label={paletteName(palette, 'voices', gameSpeaker.voice)}
          />
        </div>
      )}
      {inGameFont ? (
        <>
          <div className="gfield-tools">
            <div className="typing-speeds" role="group" aria-label={t('field.scale')}>
              {[2, 3, 4].map((k) => (
                <button
                  key={k}
                  type="button"
                  className="typing-speed"
                  aria-pressed={fieldScale === k}
                  onClick={() => setFieldScale((lastFieldScale = k))}
                >
                  ×{k}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="typing-speed"
              aria-pressed={moving}
              onClick={() => setMoving((lastMoving = !moving))}
            >
              {t('field.effects')}
            </button>
            <span className="muted small">{t('field.hint')}</span>
          </div>
          <GameTextField
            text={line.text}
            line={fieldLine!}
            font={font!}
            preview={palette.preview!}
            scale={fieldScale}
            moving={moving}
            plot={plotRanges}
            cues={fieldCues}
            readOnly={readOnly}
            textarea={{
              'aria-label': t('story.lines.text', { n: index + 1 }),
              onKeyDown,
              onSelect: (e) => {
                textBox.current = e.currentTarget;
                caret.current = e.currentTarget.selectionStart;
              },
              onFocus: (e) => {
                textBox.current = e.currentTarget;
              },
              onChange: (e) =>
                edit(
                  t('story.step.lines'),
                  (g) => updateLine(g, nodeId, line.id, { text: e.target.value }),
                  `line:${line.id}`,
                ),
            }}
            onMenu={menu.openAt}
            onCue={cueClick}
            onMoveCue={(id, at) => change((n) => moveCue(n, id, at))}
            toolbar={readOnly ? undefined : toolbar}
          />
          <input
            ref={colorInput}
            type="color"
            className="gfield-color"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const sel = colorFor.current;
              if (sel) change((n) => void addStyleMark(n, line.id, sel, { color: e.target.value }), `color:${line.id}`);
            }}
          />
        </>
      ) : (
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
          onSelect={(e) => {
            textBox.current = e.currentTarget;
            caret.current = e.currentTarget.selectionStart;
          }}
          onFocus={(e) => {
            textBox.current = e.currentTarget;
          }}
          onChange={(e) =>
            edit(
              t('story.step.lines'),
              (g) => updateLine(g, nodeId, line.id, { text: e.target.value }),
              `line:${line.id}`,
            )
          }
        />
      )}
      {menu.menu}
      <Translation translations={translations} id={line.id} edited={(line as { edited?: string }).edited} />
      {!inGameFont && <LinePreview node={node} line={line} palette={palette} nameOf={nameOf} />}
      <div className="iline-game">
        <PaletteInput
          palette={palette}
          list="styles"
          value={line.style}
          label={t('line.style')}
          disabled={readOnly}
          onChange={(v) => set({ style: v }, `style:${line.id}`)}
        />
        <PaletteSelect
          label={t('line.face')}
          value={line.face}
          items={faces.items}
          gray={noPalette ? null : faces.gray}
          noPalette={noPalette}
          disabled={readOnly}
          autoOpen={openField === 'face'}
          onOpened={() => setOpenField(null)}
          onChange={(v) => set({ face: v }, `face:${line.id}`)}
        />
        <TowardInput
          palette={palette}
          list="gestures"
          value={line.gesture}
          label={t('line.gesture')}
          people={others}
          nameOf={nameOf}
          disabled={readOnly}
          autoOpen={openField === 'gesture'}
          onOpened={() => setOpenField(null)}
          onChange={(v) => set({ gesture: v }, `gesture:${line.id}`)}
        />
        <TowardInput
          palette={palette}
          list="emotes"
          value={line.emote}
          label={t('line.emote')}
          people={others}
          nameOf={nameOf}
          disabled={readOnly}
          autoOpen={openField === 'emote'}
          onOpened={() => setOpenField(null)}
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
                  node={node}
                  mark={m}
                  text={line.text}
                  palette={palette}
                  people={people}
                  speaker={line.speaker}
                  entities={entities}
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
      {menuAt && (
        <Menu x={menuAt.x} y={menuAt.y} label={menuAt.label} entries={menuAt.entries} onClose={() => setMenuAt(null)} />
      )}
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
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
  node,
  mark: m,
  text,
  palette,
  people,
  speaker,
  entities,
  readOnly,
  onProps,
  onRemove,
}: {
  node: StoryNode;
  mark: TextMark;
  text: string;
  palette: Palette;
  people: string[];
  speaker: string | null;
  entities: ProjectData['entities'];
  readOnly: boolean;
  onProps: (props: StyleProps | CueProps) => void;
  onRemove: () => void;
}) {
  const nameOf = (id: string) => speakerName(entities, id);
  const remove = !readOnly && (
    <IconButton size="sm" label={t('line.markRemove')} icon={<X size={14} />} onClick={onRemove} />
  );
  if (m.device === 'style') {
    const r = resolveRange(text, m.range);
    const p = m.props;
    // A look without any props goes away by itself (tidyNode).
    const put = (patch: Partial<StyleProps>) => onProps({ ...p, ...patch });
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
  const atStart = startCue(node, m);
  // A face is one of its owner's faces: the speaker's, or the one it is for.
  const faceOwner = kind === 'face' ? (toward(m.props.face)?.to ?? speaker) : speaker;
  const faces = faceItems(palette, entities, faceOwner);
  let value;
  if (kind === 'pause' || kind === 'shake') {
    value = (
      <NumberBlank
        label={t(kind === 'pause' ? 'cue.seconds' : 'cue.strength')}
        value={m.props[kind]}
        disabled={readOnly}
        // Blank takes the cue away (a pause of nothing is nothing).
        onChange={(n) => onProps({ [kind]: n })}
      />
    );
  } else if (kind === 'sound') {
    value = (
      <PaletteInput
        palette={palette}
        list="sounds"
        value={m.props.sound}
        label={t(CUE_NAMES[kind])}
        disabled={readOnly}
        onChange={(sound) => onProps({ sound })}
      />
    );
  } else {
    value = (
      <TowardInput
        palette={palette}
        list={kind === 'gesture' ? 'gestures' : kind === 'emote' ? 'emotes' : 'faces'}
        items={kind === 'face' ? faces.items : undefined}
        gray={kind === 'face' && palette.loaded ? faces.gray : null}
        value={m.props[kind]}
        label={t(CUE_NAMES[kind])}
        people={people.filter((x) => x !== speaker)}
        nameOf={nameOf}
        disabled={readOnly}
        onChange={(v) => onProps({ [kind]: v })}
      />
    );
  }
  return (
    <div
      className={['tmark', 'tmark-cue', atStart && 'tmark-bad'].filter(Boolean).join(' ')}
      data-field={`tmark:${m.id}`}
      title={atStart ? t('line.startCueHint') : undefined}
    >
      <div className="tmark-head">
        <Icon size={13} aria-hidden="true" />
        <span className="tmark-what">{t(CUE_NAMES[kind])}</span>
        <span className="tmark-where muted small">
          {atStart ? t('line.startCue') : t('cue.after', { text: before })}
        </span>
        {remove}
      </div>
      <div className="tmark-props">{value}</div>
    </div>
  );
}
