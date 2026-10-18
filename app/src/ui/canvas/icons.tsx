import {
  Flag,
  Gem,
  Heart,
  Key,
  MapPin,
  MessageSquare,
  Shield,
  Skull,
  Star,
  Sword,
  User,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** Icons a node can carry (FR-CNV-10). Stored by id in the graph file, so the set can grow. */
export const NODE_ICONS: Record<string, LucideIcon> = {
  user: User,
  message: MessageSquare,
  pin: MapPin,
  flag: Flag,
  star: Star,
  key: Key,
  sword: Sword,
  shield: Shield,
  gem: Gem,
  heart: Heart,
  skull: Skull,
  zap: Zap,
};

export function NodeIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Icon = NODE_ICONS[name];
  return Icon ? <Icon size={size} className="cnode-icon" aria-hidden="true" /> : null;
}
