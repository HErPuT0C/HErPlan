// A value picked from the game's palette (0.8.1, "Редактор реплик" 2): a list that shows what the author
// needs to choose — a style in its colour, a face or an emote by its picture, a sound with ▶ to hear it, a hint
// on hover. "— нет —" comes first and takes the field out of the file. Typed by hand only when the project has
// no palette (a yellow frame); a value the palette no longer has stays, in a red frame.

import { Play } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAtom } from '../../core/useStore';
import { t } from '../../i18n';
import { gameFiles } from '../../state/gameFiles';
import type { PaletteIcon } from '../../story/palette';
import { playSound, useImage } from './gameAssets';

export interface SelectItem {
  id: string;
  name: string;
  color?: string;
  hint?: string;
  /** A picture before the name. */
  icon?: ReactNode;
  /** A sound to hear (from data/). */
  sound?: string;
  /** Shown while the item is pointed at (an effect on a sample word). */
  sample?: ReactNode;
}

/** A frame of a strip of pictures, drawn pixel for pixel. */
export function SpriteFrame({ icon, scale = 2 }: { icon: PaletteIcon; scale?: number }) {
  const dir = useAtom(gameFiles).dir;
  const img = useImage(dir, icon.image);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!img) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, icon.frame * icon.w, 0, icon.w, icon.h, 0, 0, icon.w * scale, icon.h * scale);
  }, [img, icon.frame, icon.w, icon.h, scale]);
  return (
    <canvas
      ref={ref}
      className="sprite-frame"
      width={icon.w * scale}
      height={icon.h * scale}
      aria-hidden="true"
      data-loaded={img ? '' : undefined}
    />
  );
}

/** ▶ beside a sound: hear it. */
export function SoundButton({ sound, label }: { sound: string | undefined; label: string }) {
  const dir = useAtom(gameFiles).dir;
  if (!sound || !dir) return null;
  return (
    <button
      type="button"
      className="palette-play"
      aria-label={t('palette.listen', { name: label })}
      title={t('palette.listen', { name: label })}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void playSound(dir, sound);
      }}
    >
      <Play size={11} />
    </button>
  );
}

export function PaletteSelect({
  label,
  value,
  items,
  onChange,
  noPalette,
  gray,
  noneLabel,
  unknownHint,
  disabled,
  className,
  autoOpen,
  onOpened,
}: {
  /** Names the field (read by screen readers, shown while it is empty). */
  label: string;
  value: string | undefined | null;
  items: readonly SelectItem[];
  /** "" (the "none" item) takes the field out. */
  onChange: (value: string) => void;
  /** The project has no palette: the value is typed (a yellow frame). */
  noPalette?: boolean;
  /** Why there is nothing to choose here (a grey field with this hint). */
  gray?: string | null;
  noneLabel?: string;
  /** What a value the list has not got is called (default: "not in the game"). */
  unknownHint?: string;
  disabled?: boolean;
  className?: string;
  /** Opens the list at once (asked from elsewhere: "+ mark" at the start of a line). */
  autoOpen?: boolean;
  onOpened?: () => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    width: number;
    up: boolean;
    /** Where the list goes: inside an open dialog (the window of a line) the page behind it is inert. */
    host: HTMLElement;
  } | null>(null);
  const current = value ?? '';
  const known = items.find((x) => x.id === current);
  const unknown = !!current && !known;
  const all: SelectItem[] = [{ id: '', name: noneLabel ?? t('palette.noneItem') }, ...items];

  const show = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    setPlace({
      left: r.left,
      top: below > 240 || below > r.top ? r.bottom + 2 : r.top - 2,
      width: r.width,
      up: !(below > 240 || below > r.top),
      host: button.current?.closest('dialog') ?? document.body,
    });
    setActive(
      Math.max(
        0,
        all.findIndex((x) => x.id === current),
      ),
    );
    setOpen(true);
  };
  useEffect(() => {
    if (!autoOpen) return;
    button.current?.focus();
    show();
    onOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const pick = (v: string) => {
    setOpen(false);
    button.current?.focus();
    if (v !== current) onChange(v);
  };

  // A press anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!list.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [open]);
  useLayoutEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  if (noPalette) {
    return (
      <input
        className={['input', 'palette-input', 'palette-missing', className].filter(Boolean).join(' ')}
        value={current}
        disabled={disabled}
        placeholder={label}
        aria-label={label}
        title={t('palette.noneShort')}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.trim())}
      />
    );
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(all[active].id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const title = gray ?? (unknown ? (unknownHint ?? t('palette.notInGame')) : (known?.hint ?? label));
  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className={[
          'input',
          'palette-input',
          'palette-select',
          unknown && 'palette-unknown',
          gray && 'palette-gray',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled || !!gray}
        title={title}
        data-value={current}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {known?.icon}
        <span
          className={['palette-value', !current && 'muted'].filter(Boolean).join(' ')}
          style={known?.color ? { color: known.color } : undefined}
        >
          {known ? known.name : current ? t('palette.unknownValue', { id: current }) : label}
        </span>
      </button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className={['palette-list', place.up && 'palette-list-up'].filter(Boolean).join(' ')}
            style={{
              left: place.left,
              minWidth: Math.max(place.width, 160),
              ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }),
            }}
          >
            {all.map((item, i) => (
              <li
                key={item.id || '\u0000none'}
                id={`${id}-${i}`}
                role="option"
                aria-selected={item.id === current}
                data-active={i === active ? '' : undefined}
                className="palette-option"
                title={item.hint}
                onPointerEnter={() => setActive(i)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(item.id)}
              >
                {item.icon}
                <span className={item.id ? undefined : 'muted'} style={item.color ? { color: item.color } : undefined}>
                  {item.name}
                </span>
                {item.sound && <SoundButton sound={item.sound} label={item.name} />}
                {i === active && item.sample && <span className="palette-sample">{item.sample}</span>}
              </li>
            ))}
            {items.length === 0 && <li className="palette-option muted small">{t('palette.emptyList')}</li>}
          </ul>,
          place.host,
        )}
    </>
  );
}
