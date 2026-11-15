// One consistent line-icon set for the homepage (restructure, Nov 15,
// 2026): Lucide (lucide-react, ISC, 1,780 icons, 24px grid) — the
// 2026 default (research: files/modern-design-research-2026-11-15.md).
// One pack for all core UI, consistent sizes (16/20/24px) and one
// stroke (1.75), never mixed weights or mixed styles. No emojis as
// icons, no icon font, no dependency beyond lucide-react. Every icon
// is decorative (aria-hidden) unless a caller adds its own label.
// The /chat icons (leg icons, slot checks) are untouched — this set
// is for the homepage: header, search tabs, category tiles, trust
// strip and package cards.
import {
  ArrowLeftRight,
  ArrowRight,
  BedDouble,
  Bookmark,
  Bus,
  Calendar,
  Camera,
  Car,
  CarTaxiFront,
  Check,
  Clock,
  Compass,
  Globe,
  Map,
  MapPin,
  Menu,
  Moon,
  Package,
  Plane,
  Plus,
  Route,
  Search,
  ShieldCheck,
  Ship,
  Sparkles,
  Sun,
  Tag,
  Ticket,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

export type IconName =
  | 'plane'
  | 'bed'
  | 'car'
  | 'ticket'
  | 'ship'
  | 'bus'
  | 'taxi'
  | 'search'
  | 'sparkle'
  | 'sun'
  | 'moon'
  | 'menu'
  | 'close'
  | 'check'
  | 'pin'
  | 'calendar'
  | 'users'
  | 'clock'
  | 'arrowRight'
  | 'arrowLeftRight'
  | 'route'
  | 'plus'
  | 'shield'
  | 'tag'
  | 'compass'
  | 'package'
  | 'bookmark'
  | 'map'
  | 'camera'
  | 'globe';

const COMPONENTS: Record<IconName, LucideIcon> = {
  plane: Plane,
  bed: BedDouble,
  car: Car,
  ticket: Ticket,
  ship: Ship,
  bus: Bus,
  taxi: CarTaxiFront,
  search: Search,
  sparkle: Sparkles,
  sun: Sun,
  moon: Moon,
  menu: Menu,
  close: X,
  check: Check,
  pin: MapPin,
  calendar: Calendar,
  users: Users,
  clock: Clock,
  arrowRight: ArrowRight,
  arrowLeftRight: ArrowLeftRight,
  route: Route,
  plus: Plus,
  shield: ShieldCheck,
  tag: Tag,
  compass: Compass,
  package: Package,
  bookmark: Bookmark,
  map: Map,
  camera: Camera,
  globe: Globe,
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const C = COMPONENTS[name];
  return <C size={size} strokeWidth={1.75} className={className} aria-hidden="true" focusable="false" />;
}

// The search tab's icon, by tab id — the same key HOME_TABS carries,
// so the header nav, the widget tabs and the category tiles can never
// disagree about which icon a category has.
export const TAB_ICONS: Record<string, IconName> = {
  flights: 'plane',
  hotels: 'bed',
  cars: 'car',
  tours: 'ticket',
  cruises: 'ship',
  buses: 'bus',
  taxis: 'taxi',
};
