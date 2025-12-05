
import React, { useRef } from 'react';
import { StickerItem } from '../types';
import { RotateCw, X } from 'lucide-react';

interface StickerCanvasProps {
  stickers: StickerItem[];
  activeId: string | null;
  onUpdate: (id: string, updates: Partial<StickerItem>) => void;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onInteractionStart: (id: string) => void;
  onInteractionEnd: (id: string) => void;
}

type DragMode = 'move' | 'rotate' | 'scale' | null;

export const StickerCanvas: React.FC<StickerCanvasProps> = ({ 
  stickers, activeId, onUpdate, onSelect, onDelete, onInteractionStart, onInteractionEnd
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragMode = useRef<DragMode>(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const centerPos = useRef({ x: 0, y: 0 }); // Center of the sticker being manipulated

  const handlePointerDown = (e: React.PointerEvent, id: string, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();
    
    if (activeId !== id) {
      onSelect(id);
    }
    
    onInteractionStart(id); // Notify App to pause tracking
    
    const sticker = stickers.find(s => s.id === id);
    if (!sticker) return;

    dragMode.current = mode;
    lastPos.current = { x: e.clientX, y: e.clientY };
    centerPos.current = { x: sticker.x, y: sticker.y };

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragMode.current || !activeId) return;
    
    const sticker = stickers.find(s => s.id === activeId);
    if (!sticker) return;

    if (dragMode.current === 'move') {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      
      onUpdate(activeId, {
         x: sticker.x + dx,
         y: sticker.y + dy
      });
      lastPos.current = { x: e.clientX, y: e.clientY };
    } 
    else if (dragMode.current === 'scale') {
      const dxFromCenter = e.clientX - centerPos.current.x;
      const dyFromCenter = e.clientY - centerPos.current.y;
      const dist = Math.sqrt(dxFromCenter * dxFromCenter + dyFromCenter * dyFromCenter);
      
      let newScale = dist / 50; // base scale factor
      if (newScale < 0.2) newScale = 0.2;
      if (newScale > 10) newScale = 10;

      onUpdate(activeId, { scale: newScale });
    } 
    else if (dragMode.current === 'rotate') {
      const angle = Math.atan2(e.clientY - centerPos.current.y, e.clientX - centerPos.current.x);
      const degrees = angle * (180 / Math.PI);
      let rotation = degrees + 90; 
      onUpdate(activeId, { rotation });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activeId && dragMode.current) {
        onInteractionEnd(activeId); // Notify App to resume tracking with new offset
    }
    dragMode.current = null;
    if (e.target instanceof HTMLElement) {
       try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}
    }
  };

  return (
    <div 
      ref={containerRef}
      className="absolute inset-0 z-30 touch-none overflow-hidden"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerDown={() => onSelect(null)}
    >
      {stickers.map((sticker) => {
        const isActive = activeId === sticker.id;
        const opacity = sticker.opacity !== undefined ? sticker.opacity : 1;
        
        return (
          <div
            key={sticker.id}
            className="absolute flex items-center justify-center touch-none select-none transition-transform duration-75 ease-linear"
            style={{
              transform: `translate(${sticker.x}px, ${sticker.y}px) rotate(${sticker.rotation}deg) scale(${sticker.scale})`,
              left: 0, top: 0,
              width: '0px', height: '0px',
              opacity: opacity,
            }}
          >
            <div 
               onPointerDown={(e) => handlePointerDown(e, sticker.id, 'move')}
               className={`relative cursor-move group ${isActive ? 'z-50' : 'z-30'}`}
            >
              <div 
                className={`relative w-32 h-32 flex items-center justify-center pointer-events-none transition-all duration-200
                  ${isActive ? 'drop-shadow-[0_0_15px_rgba(168,85,247,0.6)]' : 'drop-shadow-md'}`}
              >
                {sticker.type === 'svg' ? (
                  <div 
                    dangerouslySetInnerHTML={{ __html: sticker.content }} 
                    className="w-full h-full text-white fill-current"
                  />
                ) : (
                  <span className="text-[5rem] leading-none">{sticker.content}</span>
                )}
              </div>

              {isActive && (
                <div className="absolute -inset-4 border-2 border-white/50 rounded-xl pointer-events-none">
                  <div 
                    className="absolute -top-3 -left-3 w-8 h-8 bg-red-500 rounded-full flex items-center justify-center pointer-events-auto cursor-pointer shadow-md hover:scale-110 transition-transform"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onDelete(sticker.id);
                    }}
                  >
                    <X size={16} className="text-white" />
                  </div>

                  <div 
                    className="absolute -top-8 left-1/2 -translate-x-1/2 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center pointer-events-auto cursor-ew-resize shadow-md hover:bg-purple-500"
                    onPointerDown={(e) => handlePointerDown(e, sticker.id, 'rotate')}
                  >
                     <RotateCw size={16} className="text-white" />
                  </div>

                  <div 
                    className="absolute -bottom-3 -right-3 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center pointer-events-auto cursor-nwse-resize shadow-md hover:bg-blue-400"
                    onPointerDown={(e) => handlePointerDown(e, sticker.id, 'scale')}
                  >
                    <div className="w-4 h-4 border-r-2 border-b-2 border-white transform rotate-45 mb-1 mr-1" />
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
