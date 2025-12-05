
import React from 'react';
import { Asset, ASSETS, Category } from '../types';

interface AssetSelectorProps {
  onSelect: (asset: Asset) => void;
  selectedCategory: Category;
  onCategoryChange: (cat: Category) => void;
}

const CATEGORIES: Category[] = ['faces', 'hats', 'glasses', 'hair', 'tops', 'accessories'];

export const AssetSelector: React.FC<AssetSelectorProps> = ({ onSelect, selectedCategory, onCategoryChange }) => {
  const filteredAssets = ASSETS.filter(a => a.category === selectedCategory);

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-end gap-4 z-40 max-h-[80vh]">
      
      {/* Semi-transparent Glass Box */}
      <div className="bg-black/20 backdrop-blur-md border border-white/10 p-4 rounded-[2rem] shadow-2xl flex flex-col gap-4 overflow-y-auto no-scrollbar w-32 items-center transition-all duration-300">
        
        {/* Category Dots */}
        <div className="flex flex-wrap justify-center gap-2 mb-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              id={`cat-btn-${cat}`} // ID for virtual touch
              onClick={() => onCategoryChange(cat)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold transition-all border ${
                selectedCategory === cat 
                  ? 'bg-white text-black border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.5)]' 
                  : 'bg-black/40 text-gray-400 border-transparent hover:bg-black/60'
              }`}
            >
              {cat.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-white/10" />

        {/* Assets List */}
        <div className="flex flex-col gap-3 w-full">
          {filteredAssets.map(asset => (
            <button
              key={asset.id}
              id={`asset-btn-${asset.id}`} // ID for virtual touch
              onClick={() => onSelect(asset)}
              className="group relative flex flex-col items-center justify-center w-full aspect-square bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-all active:scale-95"
            >
              <div className="w-16 h-16 flex items-center justify-center p-2 drop-shadow-lg transition-transform group-hover:scale-110">
                {asset.type === 'svg' ? (
                  <div 
                    dangerouslySetInnerHTML={{ __html: asset.content }} 
                    className="w-full h-full text-white fill-current pointer-events-none"
                  />
                ) : (
                  <span className="text-4xl pointer-events-none">{asset.content}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
