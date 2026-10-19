import {
  BookOpen,
  Clapperboard,
  CornerDownRight,
  Crosshair,
  Diamond,
  Flag,
  MapPin,
  MessagesSquare,
  Package,
  Play,
  Split,
  Square,
  StickyNote,
  UserRound,
  Zap,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';

/** HErPlan's own butterfly (the icon set has none), drawn in the same 24-unit, 2-pixel stroke style. */
export function ButterflyIcon({ size = 24, ...rest }: LucideProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d="M12 8v11" />
      <path d="M12 8 10 4.5M12 8l2-3.5" />
      <path d="M12 11C9.5 6.5 4 5.5 3.5 8.5c-.5 3 3 4.5 8.5 3.5" />
      <path d="M12 11c2.5-4.5 8-5.5 8.5-2.5.5 3-3 4.5-8.5 3.5" />
      <path d="M12 13c-3.5 0-6 2.5-4.5 5 1.2 2 3.5.5 4.5-2" />
      <path d="M12 13c3.5 0 6 2.5 4.5 5-1.2 2-3.5.5-4.5-2" />
    </svg>
  );
}

const ICONS: Record<string, ComponentType<LucideProps>> = {
  node: Square,
  sticker: StickyNote,
  start: Play,
  scene: Clapperboard,
  dialogue: MessagesSquare,
  choice: Split,
  end: Flag,
  jump: CornerDownRight,
  chapter: BookOpen,
  condition: Diamond,
  effect: Zap,
  butterfly: ButterflyIcon,
  gun: Crosshair,
  character: UserRound,
  location: MapPin,
  item: Package,
};

/** The icon of a node kind, for menus, card headers and panels. */
export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = ICONS[kind] ?? Square;
  return <Icon size={size} aria-hidden="true" />;
}
