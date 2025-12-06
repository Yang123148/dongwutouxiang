
export type Category = 'hats' | 'glasses' | 'tops' | 'hair' | 'accessories' | 'faces';
export type AnchorType = 'head' | 'eyes' | 'body' | 'face' | 'none';

export interface StickerItem {
  id: string;
  type: 'emoji' | 'svg';
  content: string; // Emoji char or SVG path/content
  category: Category;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity?: number; // For fading effects
  
  // Tracking properties
  anchorType: AnchorType;
  anchorOffset: { x: number; y: number };
  baseScale: number;
  baseRotation: number;

  // Lifecycle for temporary effects
  createdAt?: number;
  lifespan?: number; // ms to exist
}

export interface CoinItem {
  id: string;
  x: number;
  y: number;
  scale: number;
  value: number;
  collected: boolean;
}

export interface Asset {
  id: string;
  type: 'emoji' | 'svg';
  content: string;
  category: Category;
  label: string;
  color?: string;
  anchorType: AnchorType;
  defaultScale: number; 
  defaultOffsetY?: number;
  effectItems?: string[]; 
}

// Complex Kawaii SVG Assets
const SVG_ASSETS = {
  glasses_dark: `<svg viewBox="0 0 200 80" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M195 25C195 25 180 25 170 30L150 35C150 35 145 10 100 10C55 10 50 35 50 35L30 30C20 25 5 25 5 25" stroke="black" stroke-width="5"/><path d="M105 35C105 35 140 35 145 60C150 85 115 80 105 80L105 35Z" fill="black" fill-opacity="0.8"/><path d="M95 35C95 35 60 35 55 60C50 85 85 80 95 80L95 35Z" fill="black" fill-opacity="0.8"/><line x1="95" y1="35" x2="105" y2="35" stroke="black" stroke-width="4"/></svg>`,
  
  glasses_reading: `<svg viewBox="0 0 200 80" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="55" cy="45" r="30" stroke="black" stroke-width="4" fill="rgba(255,255,255,0.2)"/><circle cx="145" cy="45" r="30" stroke="black" stroke-width="4" fill="rgba(255,255,255,0.2)"/><line x1="85" y1="45" x2="115" y2="45" stroke="black" stroke-width="3"/><path d="M25 45L5 40" stroke="black" stroke-width="3"/><path d="M175 45L195 40" stroke="black" stroke-width="3"/></svg>`,

  cap_blue: `<svg viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg"><filter id="shadow"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-opacity="0.3"/></filter><g filter="url(#shadow)"><path d="M20 100C20 60 60 20 100 20C140 20 180 60 180 100" fill="#3B82F6" stroke="black" stroke-width="2"/><path d="M180 100L220 110C220 110 180 130 140 120" fill="#2563EB" stroke="black" stroke-width="2"/><circle cx="100" cy="15" r="6" fill="#1D4ED8"/></g></svg>`,
  
  hair_long: `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg"><path d="M100 20C60 20 30 50 20 100C10 150 10 200 20 230C40 240 60 200 60 180C60 180 80 180 100 180C120 180 140 180 140 180C140 200 160 240 180 230C190 200 190 150 180 100C170 50 140 20 100 20Z" fill="#FCD34D" stroke="#D97706" stroke-width="2" opacity="0.9"/></svg>`,

  tshirt_white: `<svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg"><g transform="translate(50, 0)"><path d="M60 20L40 40L10 30L20 80L50 70L50 190L150 190L150 70L180 80L190 30L160 40L140 20C140 20 120 40 100 40C80 40 60 20 60 20Z" fill="white" stroke="#9CA3AF" stroke-width="2"/><path d="M80 20C80 20 90 35 100 35C110 35 120 20 120 20" fill="none" stroke="#9CA3AF" stroke-width="1"/></g></svg>`,
  
  bowtie: `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg"><path d="M50 30L10 10V50L50 30Z" fill="#DC2626"/><path d="M50 30L90 10V50L50 30Z" fill="#DC2626"/><rect x="45" y="25" width="10" height="10" rx="2" fill="#991B1B"/></svg>`,

  coin: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="45" fill="#FFD700" stroke="#DAA520" stroke-width="5" />
    <circle cx="50" cy="50" r="35" fill="none" stroke="#DAA520" stroke-width="2" stroke-dasharray="5,5" />
    <text x="50" y="65" font-family="Arial, sans-serif" font-size="40" font-weight="bold" fill="#B8860B" text-anchor="middle">$</text>
    <path d="M30 30 L 40 20" stroke="white" stroke-width="4" opacity="0.6" />
  </svg>`,
  
  // -- UPDATED ANIMAL FACES --

  rabbit_face: `<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg">
    <!-- Ears -->
    <path d="M60 100 C 40 40, 60 0, 80 10 C 100 20, 90 90, 80 100" fill="#FFE4E1" stroke="#333" stroke-width="3"/>
    <path d="M70 70 C 65 40, 75 20, 80 25" fill="#FFB6C1" />
    <path d="M140 100 C 160 40, 140 0, 120 10 C 100 20, 110 90, 120 100" fill="#FFE4E1" stroke="#333" stroke-width="3"/>
    <path d="M130 70 C 135 40, 125 20, 120 25" fill="#FFB6C1" />
    <!-- Face -->
    <ellipse cx="100" cy="140" rx="70" ry="60" fill="#FFF0F5" stroke="#333" stroke-width="3"/>
    <!-- Eyes -->
    <circle cx="70" cy="130" r="8" fill="#333"/>
    <circle cx="130" cy="130" r="8" fill="#333"/>
    <circle cx="73" cy="127" r="3" fill="white"/>
    <circle cx="133" cy="127" r="3" fill="white"/>
    <!-- Nose/Mouth -->
    <path d="M92 145 Q 100 155 108 145" fill="none" stroke="#333" stroke-width="2"/>
    <path d="M100 148 L 100 160" stroke="#333" stroke-width="2"/>
    <path d="M100 160 Q 90 170 80 160" fill="none" stroke="#333" stroke-width="2"/>
    <path d="M100 160 Q 110 170 120 160" fill="none" stroke="#333" stroke-width="2"/>
    <circle cx="100" cy="145" r="4" fill="#FFB6C1"/>
    <!-- Cheeks -->
    <circle cx="50" cy="150" r="10" fill="#FFB6C1" opacity="0.6"/>
    <circle cx="150" cy="150" r="10" fill="#FFB6C1" opacity="0.6"/>
  </svg>`,

  panda_face: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <!-- Ears -->
    <circle cx="40" cy="50" r="25" fill="#333"/>
    <circle cx="160" cy="50" r="25" fill="#333"/>
    <!-- Face -->
    <ellipse cx="100" cy="110" rx="75" ry="65" fill="white" stroke="#333" stroke-width="3"/>
    <!-- Eye Patches -->
    <ellipse cx="65" cy="100" rx="22" ry="18" fill="#333" transform="rotate(-30 65 100)"/>
    <ellipse cx="135" cy="100" rx="22" ry="18" fill="#333" transform="rotate(30 135 100)"/>
    <!-- Eyes -->
    <circle cx="68" cy="98" r="5" fill="white"/>
    <circle cx="132" cy="98" r="5" fill="white"/>
    <circle cx="68" cy="98" r="2" fill="black"/>
    <circle cx="132" cy="98" r="2" fill="black"/>
    <!-- Nose -->
    <ellipse cx="100" cy="125" rx="8" ry="5" fill="#333"/>
    <path d="M100 130 L 100 140" stroke="#333" stroke-width="2"/>
    <path d="M100 140 Q 90 150 85 140" fill="none" stroke="#333" stroke-width="2"/>
    <path d="M100 140 Q 110 150 115 140" fill="none" stroke="#333" stroke-width="2"/>
  </svg>`,

  dog_face: `<svg viewBox="0 0 220 200" xmlns="http://www.w3.org/2000/svg">
    <!-- Ears -->
    <path d="M30 60 Q 10 100 30 140 L 50 120 Z" fill="#D2691E" stroke="#5D4037" stroke-width="2"/>
    <path d="M190 60 Q 210 100 190 140 L 170 120 Z" fill="#D2691E" stroke="#5D4037" stroke-width="2"/>
    <!-- Head -->
    <path d="M50 50 Q 110 10 170 50 L 170 130 Q 110 180 50 130 Z" fill="#DEB887" stroke="#5D4037" stroke-width="3"/>
    <!-- Spot -->
    <circle cx="140" cy="70" r="20" fill="#D2691E" opacity="0.8"/>
    <!-- Eyes -->
    <ellipse cx="80" cy="80" rx="8" ry="12" fill="#333"/>
    <circle cx="82" cy="76" r="3" fill="white"/>
    <ellipse cx="140" cy="80" rx="8" ry="12" fill="#333"/>
    <circle cx="142" cy="76" r="3" fill="white"/>
    <!-- Snout -->
    <ellipse cx="110" cy="115" rx="25" ry="18" fill="#F5DEB3"/>
    <circle cx="110" cy="105" r="8" fill="#333"/>
    <path d="M110 113 L 110 125" stroke="#333" stroke-width="2"/>
    <path d="M110 125 Q 95 135 90 120" fill="none" stroke="#333" stroke-width="2"/>
    <path d="M110 125 Q 125 135 130 120" fill="none" stroke="#333" stroke-width="2"/>
    <!-- Tongue -->
    <path d="M105 130 Q 110 145 115 130" fill="#FF69B4" stroke="#FF1493"/>
  </svg>`,

  cat_face: `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <!-- Ears -->
    <path d="M40 70 L 20 20 L 80 40 Z" fill="#FFA500" stroke="#333" stroke-width="3"/>
    <path d="M35 60 L 28 35 L 60 45 Z" fill="#FFD700"/>
    <path d="M160 70 L 180 20 L 120 40 Z" fill="#FFA500" stroke="#333" stroke-width="3"/>
    <path d="M165 60 L 172 35 L 140 45 Z" fill="#FFD700"/>
    <!-- Head -->
    <ellipse cx="100" cy="110" rx="70" ry="60" fill="#FFA500" stroke="#333" stroke-width="3"/>
    <!-- Stripes -->
    <path d="M100 55 L 90 70 M 100 55 L 100 75 M 100 55 L 110 70" stroke="#D2691E" stroke-width="3"/>
    <path d="M40 110 L 60 110" stroke="#D2691E" stroke-width="3"/>
    <path d="M160 110 L 140 110" stroke="#D2691E" stroke-width="3"/>
    <!-- Eyes -->
    <ellipse cx="70" cy="100" rx="10" ry="15" fill="white"/>
    <ellipse cx="70" cy="100" rx="3" ry="10" fill="#333"/>
    <ellipse cx="130" cy="100" rx="10" ry="15" fill="white"/>
    <ellipse cx="130" cy="100" rx="3" ry="10" fill="#333"/>
    <!-- Nose -->
    <path d="M95 125 L 105 125 L 100 132 Z" fill="pink" stroke="#333" stroke-width="1"/>
    <!-- Whiskers -->
    <path d="M50 120 L 20 115 M 50 125 L 20 125 M 50 130 L 20 135" stroke="#333"/>
    <path d="M150 120 L 180 115 M 150 125 L 180 125 M 150 130 L 180 135" stroke="#333"/>
  </svg>`
};

export const ASSETS: Asset[] = [
  // Animal Faces (Anchor to face center)
  { 
    id: 'f1_rabbit', 
    type: 'svg', 
    content: SVG_ASSETS.rabbit_face, 
    category: 'faces', 
    label: 'Rabbit', 
    anchorType: 'face', 
    defaultScale: 1.6,
    effectItems: ['🥕', '🥕'] 
  },
  { 
    id: 'f2_panda', 
    type: 'svg', 
    content: SVG_ASSETS.panda_face, 
    category: 'faces', 
    label: 'Panda', 
    anchorType: 'face', 
    defaultScale: 1.5,
    effectItems: ['🎍', '🎋']
  },
  { 
    id: 'f3_dog', 
    type: 'svg', 
    content: SVG_ASSETS.dog_face, 
    category: 'faces', 
    label: 'Dog', 
    anchorType: 'face', 
    defaultScale: 1.6,
    effectItems: ['🦴', '🍖']
  },
  { 
    id: 'f4_cat', 
    type: 'svg', 
    content: SVG_ASSETS.cat_face, 
    category: 'faces', 
    label: 'Cat', 
    anchorType: 'face', 
    defaultScale: 1.5,
    effectItems: ['🐾', '🐟']
  },

  // Hats (Anchor to head)
  { id: 'h1', type: 'svg', content: SVG_ASSETS.cap_blue, category: 'hats', label: 'Cap', anchorType: 'head', defaultScale: 1.5, defaultOffsetY: -0.6 },
  { id: 'h2', type: 'emoji', content: '👑', category: 'hats', label: 'Crown', anchorType: 'head', defaultScale: 0.8, defaultOffsetY: -0.8 },
  { id: 'h3', type: 'emoji', content: '🎩', category: 'hats', label: 'Top Hat', anchorType: 'head', defaultScale: 1.0, defaultOffsetY: -0.8 },
  
  // Glasses (Anchor to eyes)
  { id: 'g1', type: 'svg', content: SVG_ASSETS.glasses_dark, category: 'glasses', label: 'Shades', anchorType: 'eyes', defaultScale: 1.0 },
  { id: 'g2', type: 'svg', content: SVG_ASSETS.glasses_reading, category: 'glasses', label: 'Round', anchorType: 'eyes', defaultScale: 1.0 },
  
  // Tops (Anchor to body)
  { id: 't1', type: 'svg', content: SVG_ASSETS.tshirt_white, category: 'tops', label: 'Tee', anchorType: 'body', defaultScale: 2.5, defaultOffsetY: 1.2 },
  { id: 't2', type: 'emoji', content: '👗', category: 'tops', label: 'Dress', anchorType: 'body', defaultScale: 2.2, defaultOffsetY: 1.2 },
  
  // Hair (Anchor to head)
  { id: 'ha1', type: 'svg', content: SVG_ASSETS.hair_long, category: 'hair', label: 'Blonde', anchorType: 'head', defaultScale: 1.8, defaultOffsetY: 0.2 },
  { id: 'ha2', type: 'emoji', content: '👨‍🦱', category: 'hair', label: 'Curly', anchorType: 'head', defaultScale: 1.4, defaultOffsetY: -0.2 },
  
  // Accessories (Anchor to body/neck)
  { id: 'a1', type: 'svg', content: SVG_ASSETS.bowtie, category: 'accessories', label: 'Bowtie', anchorType: 'body', defaultScale: 0.8, defaultOffsetY: 0.6 },
  { id: 'a2', type: 'emoji', content: '🧣', category: 'accessories', label: 'Scarf', anchorType: 'body', defaultScale: 1.5, defaultOffsetY: 0.8 },
];

export const COIN_SVG = SVG_ASSETS.coin;
