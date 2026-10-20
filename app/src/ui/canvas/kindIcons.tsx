import {
  BookOpen,
  Clapperboard,
  CornerDownRight,
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

function Svg({ size = 24, children, ...rest }: LucideProps) {
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
      {children}
    </svg>
  );
}

// HErPlan's own plot device icons (the icon set has none), drawn in the same 24-unit, 2-pixel stroke style.

/** Butterfly effect. */
export function ButterflyIcon(props: LucideProps) {
  return (
    <Svg {...props}>
      <path d="M12 8v11" />
      <path d="M12 8 10 4.5M12 8l2-3.5" />
      <path d="M12 11C9.5 6.5 4 5.5 3.5 8.5c-.5 3 3 4.5 8.5 3.5" />
      <path d="M12 11c2.5-4.5 8-5.5 8.5-2.5.5 3-3 4.5-8.5 3.5" />
      <path d="M12 13c-3.5 0-6 2.5-4.5 5 1.2 2 3.5.5 4.5-2" />
      <path d="M12 13c3.5 0 6 2.5 4.5 5-1.2 2-3.5.5-4.5-2" />
    </Svg>
  );
}

/** Consequence of a butterfly effect: a small butterfly and the long way its effect travels. */
export function ConsequenceIcon(props: LucideProps) {
  return (
    <Svg {...props}>
      <path d="M6 7.5C4.8 4.8 2.2 4.6 2 6.6c-.2 1.7 2 2.2 4 .9" />
      <path d="M6 7.5c1.2-2.7 3.8-2.9 4-.9.2 1.7-2 2.2-4 .9" />
      <path d="M6 9.5c0 6 4.5 9.5 13 9.5" />
      <path d="m16 16 3 3-3 3" />
    </Svg>
  );
}

/** Chekhov's gun: a hunting rifle, as it hangs on the wall in the first act. */
export function GunIcon(props: LucideProps) {
  return (
    <Svg {...props}>
      <path d="M2 12.5 8.5 9.5H22" />
      <path d="M2 12.5V15l7.5-3H13" />
      <path d="M10 12v2.5h2.5" />
      <path d="M19.5 9.5V8" />
    </Svg>
  );
}

/** Where the gun fires: the rifle with a flash at the muzzle. */
export function PayoffIcon(props: LucideProps) {
  return (
    <Svg {...props}>
      <path d="M1.5 13 7 10.5h8" />
      <path d="M1.5 13v2.5l6-2.5H10" />
      <path d="M8 13v2.5h2.5" />
      <path d="M18 10.5h4M17.5 7l2-2M17.5 14l2 2" />
    </Svg>
  );
}

/** A device's own icon (where it is set up) and the icon of where it lands. */
export function DeviceIcon({ device, size = 16 }: { device: 'gun' | 'butterfly'; size?: number }) {
  const Icon = device === 'gun' ? GunIcon : ButterflyIcon;
  return <Icon size={size} aria-hidden="true" />;
}

export function LandingIcon({ device, size = 16 }: { device: 'gun' | 'butterfly'; size?: number }) {
  const Icon = device === 'gun' ? PayoffIcon : ConsequenceIcon;
  return <Icon size={size} aria-hidden="true" />;
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
  gun: GunIcon,
  character: UserRound,
  location: MapPin,
  item: Package,
};

/** The icon of a node kind, for menus, card headers and panels. */
export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = ICONS[kind] ?? Square;
  return <Icon size={size} aria-hidden="true" />;
}
