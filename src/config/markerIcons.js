// ---------------------------------------------------------------------------
// Curated marker-icon catalog — a focused subset of lucide-react icons
// grouped into the categories the screenshots-as-spec called out:
// Shapes, Transportation, Places & Activities, Infrastructure, Nature.
//
// Why lucide and not Maki / Font Awesome:
//   • already a dep — no new install / bundle hit
//   • permissively licensed (ISC) and tree-shakeable
//   • covers every workflow the GLOF dashboard surfaces today
//
// Each entry is { id, label, Component }. `id` is the persistent key
// the layer style stores; `Component` is the React icon used both by
// the picker UI (for visual rendering) and by the SVG-to-image helper
// (it serialises the component to a static SVG string for Mapbox's
// addImage).
//
// To add an icon: import its lucide-react component, append to the
// right category. To add a category: add a new entry to CATEGORIES
// with `id`, `label`, `icons`. Nothing else needs touching — the
// picker auto-renders categories in declaration order.
// ---------------------------------------------------------------------------

import {
  Circle,
  Square,
  Triangle,
  Diamond,
  Hexagon,
  Octagon,
  Star,
  Heart,
  Plus,
  X,
  // Transportation
  Car,
  Truck,
  Bike,
  Bus,
  Train,
  Plane,
  Ship,
  Ambulance,
  Sailboat,
  Fuel,
  // Places / activities
  Home,
  Building2,
  Hospital,
  School,
  Hotel,
  Store,
  Utensils,
  Coffee,
  ShoppingBag,
  TentTree,
  Tent,
  Mountain,
  Trees,
  Camera,
  Flag,
  MapPin,
  Landmark,
  Church,
  // Infrastructure
  Antenna,
  Radio,
  Wifi,
  Zap,
  Plug,
  Lightbulb,
  Construction,
  Factory,
  Pipette,
  Drill,
  Warehouse,
  Wrench,
  // Nature / environment
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  Snowflake,
  Wind,
  Droplets,
  Waves,
  Flame,
  Leaf,
  Bird,
  Fish,
} from 'lucide-react';

export const CATEGORIES = [
  {
    id: 'shapes',
    label: 'Shapes',
    icons: [
      { id: 'circle',   label: 'Circle',   Component: Circle },
      { id: 'square',   label: 'Square',   Component: Square },
      { id: 'triangle', label: 'Triangle', Component: Triangle },
      { id: 'diamond',  label: 'Diamond',  Component: Diamond },
      { id: 'hexagon',  label: 'Hexagon',  Component: Hexagon },
      { id: 'octagon',  label: 'Octagon',  Component: Octagon },
      { id: 'star',     label: 'Star',     Component: Star },
      { id: 'heart',    label: 'Heart',    Component: Heart },
      { id: 'plus',     label: 'Plus',     Component: Plus },
      { id: 'cross',    label: 'Cross',    Component: X },
    ],
  },
  {
    id: 'transportation',
    label: 'Transportation',
    icons: [
      { id: 'car',       label: 'Car',       Component: Car },
      { id: 'truck',     label: 'Truck',     Component: Truck },
      { id: 'bike',      label: 'Bike',      Component: Bike },
      { id: 'bus',       label: 'Bus',       Component: Bus },
      { id: 'train',     label: 'Train',     Component: Train },
      { id: 'plane',     label: 'Plane',     Component: Plane },
      { id: 'ship',      label: 'Ship',      Component: Ship },
      { id: 'ambulance', label: 'Ambulance', Component: Ambulance },
      { id: 'sailboat',  label: 'Sailboat',  Component: Sailboat },
      { id: 'fuel',      label: 'Fuel',      Component: Fuel },
    ],
  },
  {
    id: 'places',
    label: 'Places & Activities',
    icons: [
      { id: 'home',         label: 'Home',         Component: Home },
      { id: 'building',     label: 'Building',     Component: Building2 },
      { id: 'hospital',     label: 'Hospital',     Component: Hospital },
      { id: 'school',       label: 'School',       Component: School },
      { id: 'hotel',        label: 'Hotel',        Component: Hotel },
      { id: 'store',        label: 'Store',        Component: Store },
      { id: 'utensils',     label: 'Restaurant',   Component: Utensils },
      { id: 'coffee',       label: 'Café',         Component: Coffee },
      { id: 'shopping-bag', label: 'Shopping',     Component: ShoppingBag },
      { id: 'tent-tree',    label: 'Camping',      Component: TentTree },
      { id: 'tent',         label: 'Tent',         Component: Tent },
      { id: 'mountain',     label: 'Mountain',     Component: Mountain },
      { id: 'trees',        label: 'Park',         Component: Trees },
      { id: 'camera',       label: 'Viewpoint',    Component: Camera },
      { id: 'flag',         label: 'Flag',         Component: Flag },
      { id: 'pin',          label: 'Pin',          Component: MapPin },
      { id: 'landmark',     label: 'Landmark',     Component: Landmark },
      { id: 'church',       label: 'Church',       Component: Church },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    icons: [
      { id: 'antenna',      label: 'Antenna',      Component: Antenna },
      { id: 'radio',        label: 'Radio',        Component: Radio },
      { id: 'wifi',         label: 'Wi-Fi',        Component: Wifi },
      { id: 'zap',          label: 'Power',        Component: Zap },
      { id: 'plug',         label: 'Plug',         Component: Plug },
      { id: 'lightbulb',    label: 'Light',        Component: Lightbulb },
      { id: 'construction', label: 'Construction', Component: Construction },
      { id: 'factory',      label: 'Factory',      Component: Factory },
      { id: 'pipette',      label: 'Sample',       Component: Pipette },
      { id: 'drill',        label: 'Drill',        Component: Drill },
      { id: 'warehouse',    label: 'Warehouse',    Component: Warehouse },
      { id: 'wrench',       label: 'Service',      Component: Wrench },
    ],
  },
  {
    id: 'nature',
    label: 'Nature & Weather',
    icons: [
      { id: 'cloud',      label: 'Cloud',     Component: Cloud },
      { id: 'cloud-rain', label: 'Rain',      Component: CloudRain },
      { id: 'cloud-snow', label: 'Snow',      Component: CloudSnow },
      { id: 'sun',        label: 'Sun',       Component: Sun },
      { id: 'snowflake',  label: 'Snowflake', Component: Snowflake },
      { id: 'wind',       label: 'Wind',      Component: Wind },
      { id: 'droplets',   label: 'Water',     Component: Droplets },
      { id: 'waves',      label: 'Waves',     Component: Waves },
      { id: 'flame',      label: 'Fire',      Component: Flame },
      { id: 'leaf',       label: 'Leaf',      Component: Leaf },
      { id: 'bird',       label: 'Bird',      Component: Bird },
      { id: 'fish',       label: 'Fish',      Component: Fish },
    ],
  },
];

// Flat map for O(1) lookup at render time. Built once at module load —
// the picker walks CATEGORIES (preserving order), the marker renderer
// walks ICONS_BY_ID (key → Component).
export const ICONS_BY_ID = (() => {
  const out = new Map();
  for (const cat of CATEGORIES) {
    for (const i of cat.icons) {
      out.set(i.id, i);
    }
  }
  return out;
})();

export function findIcon(id) {
  return id ? ICONS_BY_ID.get(id) ?? null : null;
}
