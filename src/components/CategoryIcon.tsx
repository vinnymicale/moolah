import {
  Tag, Briefcase, Gift, Percent, TrendingUp, RotateCcw, PlusCircle, Home, Zap, Wifi,
  Wrench, ShoppingCart, Utensils, Car, Fuel, ShoppingBag, HeartPulse, Shield,
  Clapperboard, Repeat, Plane, Sparkles, Baby, GraduationCap, CreditCard, PiggyBank,
  Landmark, Receipt, type LucideIcon,
} from "lucide-react";

const REGISTRY: Record<string, LucideIcon> = {
  tag: Tag,
  briefcase: Briefcase,
  gift: Gift,
  percent: Percent,
  "trending-up": TrendingUp,
  "rotate-ccw": RotateCcw,
  "plus-circle": PlusCircle,
  home: Home,
  zap: Zap,
  wifi: Wifi,
  wrench: Wrench,
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  car: Car,
  fuel: Fuel,
  "shopping-bag": ShoppingBag,
  "heart-pulse": HeartPulse,
  shield: Shield,
  clapperboard: Clapperboard,
  repeat: Repeat,
  plane: Plane,
  sparkles: Sparkles,
  baby: Baby,
  "graduation-cap": GraduationCap,
  "credit-card": CreditCard,
  "piggy-bank": PiggyBank,
  landmark: Landmark,
  receipt: Receipt,
};

export const CATEGORY_ICON_NAMES = Object.keys(REGISTRY);

export function CategoryIcon({
  name,
  className,
  size = 16,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  const Icon = REGISTRY[name] ?? Tag;
  return <Icon size={size} className={className} />;
}
