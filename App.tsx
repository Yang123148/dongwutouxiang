
import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, AlertCircle, X, Camera, ScanFace, Hand, Fingerprint, Scissors, Trash2, RotateCcw } from 'lucide-react';
import { Asset, ASSETS, StickerItem, Category } from './types';
import { AssetSelector } from './components/AssetSelector';
import { StickerCanvas } from './components/StickerCanvas';
import { analyzeStyle } from './services/geminiService';
import { initializeVision, detectFace, detectHands, getAnchorData } from './services/visionService';

// Constants for Gesture Interaction
const HOVER_THRESHOLD_MS = 2500; 
const BUTTON_HOVER_THRESHOLD_MS = 1500; 
const DROP_THRESHOLD_MS = 1500;  
const INTERACTION_RADIUS = 60;   

// Hand Gestures
const RESIZE_START_THRESHOLD = 0.05; 
const RESIZE_FACTOR = 15;
const SWIPE_VELOCITY_THRESHOLD = 0.02; // Normalized coord diff per frame
const GESTURE_COOLDOWN_MS = 1000;

// Effect Spawn
const EFFECT_COOLDOWN_MS = 200; 
const EFFECT_LIFESPAN = 2000; // 2 seconds
const EFFECT_FADE_DURATION = 500; // Last 500ms

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number>(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [activeStickerId, setActiveStickerId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category>('faces');
  
  // Tracking State
  const interactingIdRef = useRef<string | null>(null); 
  const [isVisionReady, setIsVisionReady] = useState(false);
  const lastFaceDataRef = useRef<any>(null);

  // Gesture State
  const [handCursor, setHandCursor] = useState<{
    x: number, y: number, 
    isDetected: boolean, 
    isResizing: boolean, 
    isOpenPalm: boolean,
    fingerCount: number
  }>({ x: 0, y: 0, isDetected: false, isResizing: false, isOpenPalm: false, fingerCount: 0 });

  const [interactionState, setInteractionState] = useState<{
    status: 'idle' | 'hovering' | 'dragging' | 'dropping_wait' | 'resizing';
    targetId: string | null; 
    targetType: 'sticker' | 'button_asset' | 'button_cat';
    progress: number; 
  }>({ status: 'idle', targetId: null, targetType: 'sticker', progress: 0 });

  // Refs for logic loop
  const hoverStartTimeRef = useRef<number>(0);
  const dropStartTimeRef = useRef<number>(0);
  const lastEffectSpawnTimeRef = useRef<number>(0);
  const lastGestureTimeRef = useRef<number>(0);
  const lastHandPosRef = useRef<{x: number, y: number} | null>(null);
  const interactionStateRef = useRef(interactionState); 
  
  useEffect(() => { interactionStateRef.current = interactionState; }, [interactionState]);

  // AI Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  // Initialize Camera & Vision
  useEffect(() => {
    const init = async () => {
      try {
        await initializeVision();
        setIsVisionReady(true);
        
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user', 
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err) {
        console.error("Init Error:", err);
        setError("Camera access required for mirror.");
      }
    };

    init();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // Main Tracking Loop (Face + Hand)
  useEffect(() => {
    const loop = () => {
      if (videoRef.current && isVisionReady && videoRef.current.readyState >= 2) {
        const now = performance.now();
        const faceResult = detectFace(videoRef.current, now);
        const handResult = detectHands(videoRef.current, now);
        
        const rect = videoRef.current.getBoundingClientRect();
        const scaleX = rect.width;
        const scaleY = rect.height;

        // --- 0. Lifecycle Management (Fade & Destroy Effects) ---
        setStickers(prev => {
          const alive = prev.filter(s => {
             if (!s.lifespan || !s.createdAt) return true;
             return (now - s.createdAt) < s.lifespan;
          });
          
          // Update opacity for fading items
          return alive.map(s => {
             if (s.lifespan && s.createdAt) {
                const age = now - s.createdAt;
                const timeRemaining = s.lifespan - age;
                if (timeRemaining < EFFECT_FADE_DURATION) {
                   return { ...s, opacity: timeRemaining / EFFECT_FADE_DURATION };
                }
             }
             return s;
          });
        });

        // --- 1. Hand Processing ---
        let cursorX = 0;
        let cursorY = 0;
        let handDetected = false;
        let isResizingGesture = false;
        let isOpenPalm = false;
        let pinchDistance = 0;
        let fingerCount = 0;

        if (handResult && handResult.landmarks.length > 0) {
          const landmarks = handResult.landmarks[0];
          const wrist = landmarks[0];
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          const middleTip = landmarks[12];
          const ringTip = landmarks[16];
          const pinkyTip = landmarks[20];
          
          // Knuckles (MCP) to check extension
          const indexMCP = landmarks[5];
          const middleMCP = landmarks[9];
          const ringMCP = landmarks[13];
          const pinkyMCP = landmarks[17];

          // Mirror logic
          cursorX = (1 - indexTip.x) * scaleX;
          cursorY = indexTip.y * scaleY;
          handDetected = true;

          // Count Fingers (Simple vertical check: Tip higher than Knuckle)
          // Note: coordinates y increases downwards. So Tip.y < MCP.y means tip is higher.
          const isIndexExt = indexTip.y < indexMCP.y;
          const isMiddleExt = middleTip.y < middleMCP.y;
          const isRingExt = ringTip.y < ringMCP.y;
          const isPinkyExt = pinkyTip.y < pinkyMCP.y;
          const isThumbExt = Math.abs(thumbTip.x - indexMCP.x) > 0.05; // Thumb is mostly horizontal

          fingerCount = (isThumbExt?1:0) + (isIndexExt?1:0) + (isMiddleExt?1:0) + (isRingExt?1:0) + (isPinkyExt?1:0);

          // Detect Thumb-Index Pinch (Resize Gesture)
          const distX = thumbTip.x - indexTip.x;
          const distY = thumbTip.y - indexTip.y;
          pinchDistance = Math.sqrt(distX * distX + distY * distY);
          
          if (pinchDistance < RESIZE_START_THRESHOLD) {
             isResizingGesture = true;
          }

          // Open Palm: 5 Fingers open
          if (fingerCount === 5) {
            isOpenPalm = true;
          }
          
          setHandCursor({ x: cursorX, y: cursorY, isDetected: true, isResizing: isResizingGesture, isOpenPalm, fingerCount });

          // --- GESTURE SWIPE LOGIC ---
          const currentHandX = landmarks[9].x; // Middle finger knuckle as center
          if (lastHandPosRef.current && (now - lastGestureTimeRef.current > GESTURE_COOLDOWN_MS)) {
              const dx = currentHandX - lastHandPosRef.current.x; // Normalized delta
              // const dy = currentHandX - lastHandPosRef.current.y;

              const isSwipe = Math.abs(dx) > SWIPE_VELOCITY_THRESHOLD;
              
              if (isSwipe) {
                  // 3 Fingers Swipe: Clear Screen
                  if (fingerCount === 3 && isIndexExt && isMiddleExt && isRingExt) {
                      setStickers([]);
                      setActiveStickerId(null);
                      lastGestureTimeRef.current = now;
                  }
                  
                  // 4 Fingers Swipe: Change Animal
                  if (fingerCount === 4 && isIndexExt && isMiddleExt && isRingExt && isPinkyExt) {
                      cycleAnimalFace();
                      lastGestureTimeRef.current = now;
                  }
              }
          }
          lastHandPosRef.current = { x: currentHandX, y: landmarks[9].y };

        } else {
          setHandCursor(prev => ({ ...prev, isDetected: false, isResizing: false, isOpenPalm: false, fingerCount: 0 }));
          lastHandPosRef.current = null;
        }

        // --- 2. Interaction Logic ---
        const currentStickers = stickers; // Note: this might be stale in loop closure if not careful, but stickers state updates usually trigger re-render
        // However, we rely on setStickers(prev => ...) for updates, so mostly ok. 
        const currentState = interactionStateRef.current;
        
        if (handDetected) {
          // A. ANIMAL EFFECT SPAWNING (Open Palm)
          if (isOpenPalm && (now - lastEffectSpawnTimeRef.current > EFFECT_COOLDOWN_MS)) {
             // Find active face sticker from state (using ref or functional update would be safer but let's try direct find on component state)
             // We need to look at 'stickers' from outer scope, which might be stale.
             // Best to assume only 1 face exists usually.
             
             // To solve stale closure issues in useEffect loop without adding stickers to dependency (which resets loop),
             // we accept that effect spawning might miss a frame update, but logic generally holds.
             
             // Actually, we can check stickers inside setStickers to ensure we match correctly
             setStickers(prevStickers => {
                 const activeFace = prevStickers.find(s => s.category === 'faces');
                 if (activeFace && (now - lastEffectSpawnTimeRef.current > EFFECT_COOLDOWN_MS)) {
                    const matchingAsset = ASSETS.find(a => activeFace.content === a.content);
                    if (matchingAsset && matchingAsset.effectItems) {
                        const items = matchingAsset.effectItems;
                        const randomItem = items[Math.floor(Math.random() * items.length)];
                        const offsetX = (Math.random() - 0.5) * 150;
                        const offsetY = (Math.random() - 0.5) * 150;
                        
                        const effectId = `eff-${Date.now()}-${Math.random()}`;
                        lastEffectSpawnTimeRef.current = now;

                        const newEffect: StickerItem = {
                            id: effectId,
                            type: 'emoji',
                            content: randomItem,
                            category: 'accessories',
                            x: cursorX + offsetX,
                            y: cursorY + offsetY,
                            scale: 2.0, // Large effect size
                            rotation: (Math.random() - 0.5) * 40,
                            anchorType: 'none',
                            anchorOffset: {x:0, y:0},
                            baseScale: 2.0,
                            baseRotation: 0,
                            createdAt: now,
                            lifespan: EFFECT_LIFESPAN,
                            opacity: 1
                        };
                        return [...prevStickers, newEffect];
                    }
                 }
                 return prevStickers;
             });
          }

          // B. RESIZING MODE (Thumb + Index)
          if (isResizingGesture && (currentState.targetId || currentState.status === 'hovering')) {
             const targetId = currentState.targetId || interactingIdRef.current;
             
             if (targetId && currentState.targetType === 'sticker') {
                 const newScaleMultiplier = Math.max(0.2, pinchDistance * RESIZE_FACTOR);
                 setStickers(prev => prev.map(s => {
                     if (s.id === targetId) {
                         return { ...s, baseScale: newScaleMultiplier }; 
                     }
                     return s;
                 }));
             }
          }
          // C. DRAGGING MODE
          else if (currentState.status === 'dragging' && currentState.targetId && currentState.targetType === 'sticker') {
            setStickers(prev => prev.map(s => {
              if (s.id === currentState.targetId) {
                return { ...s, x: cursorX, y: cursorY };
              }
              return s;
            }));

            // Drop Logic
             if (dropStartTimeRef.current === 0) dropStartTimeRef.current = now;
             const dropProgress = Math.min((now - dropStartTimeRef.current) / DROP_THRESHOLD_MS, 1);
             setInteractionState(prev => ({ ...prev, progress: dropProgress, status: 'dragging' }));

             if (dropProgress >= 1) {
               handleHandDrop(currentState.targetId);
               setInteractionState({ status: 'idle', targetId: null, targetType: 'sticker', progress: 0 });
               dropStartTimeRef.current = 0;
             }
          } 
          else {
            // MODE: IDLE or HOVERING (Selection Logic)
            const element = document.elementFromPoint(cursorX, cursorY);
            let hoveredButtonId: string | null = null;
            let hoveredType: 'button_asset' | 'button_cat' | null = null;

            if (element) {
              const btn = element.closest('button');
              if (btn && btn.id) {
                if (btn.id.startsWith('asset-btn-')) {
                  hoveredButtonId = btn.id.replace('asset-btn-', '');
                  hoveredType = 'button_asset';
                } else if (btn.id.startsWith('cat-btn-')) {
                  hoveredButtonId = btn.id.replace('cat-btn-', '');
                  hoveredType = 'button_cat';
                }
              }
            }

            if (hoveredButtonId && hoveredType) {
                if (currentState.targetId !== hoveredButtonId) {
                    hoverStartTimeRef.current = now;
                    setInteractionState({ status: 'hovering', targetId: hoveredButtonId, targetType: hoveredType, progress: 0 });
                } else {
                    const elapsed = now - hoverStartTimeRef.current;
                    const progress = Math.min(elapsed / BUTTON_HOVER_THRESHOLD_MS, 1);
                    setInteractionState(prev => ({ ...prev, progress }));

                    if (progress >= 1) {
                        if (hoveredType === 'button_cat') {
                           setSelectedCategory(hoveredButtonId as Category);
                           setInteractionState({ status: 'idle', targetId: null, targetType: 'sticker', progress: 0 }); 
                        } else if (hoveredType === 'button_asset') {
                           const asset = ASSETS.find(a => a.id === hoveredButtonId);
                           if (asset) {
                               const newId = handleAddSticker(asset, cursorX, cursorY);
                               interactingIdRef.current = newId;
                               setInteractionState({ status: 'dragging', targetId: newId, targetType: 'sticker', progress: 0 });
                               dropStartTimeRef.current = now; 
                           }
                        }
                        hoverStartTimeRef.current = 0; 
                    }
                }
            } else {
                let closestId: string | null = null;
                let minDst = Infinity;

                // Only interact with non-expiring stickers
                const interactableStickers = currentStickers.filter(s => !s.lifespan);

                for (const s of interactableStickers) {
                  const dx = s.x - cursorX;
                  const dy = s.y - cursorY;
                  const dist = Math.sqrt(dx * dx + dy * dy);
                  if (dist < INTERACTION_RADIUS && dist < minDst) {
                    minDst = dist;
                    closestId = s.id;
                  }
                }

                if (closestId) {
                  if (currentState.targetId !== closestId) {
                    hoverStartTimeRef.current = now;
                    setInteractionState({ status: 'hovering', targetId: closestId, targetType: 'sticker', progress: 0 });
                  } else {
                    const elapsed = now - hoverStartTimeRef.current;
                    const progress = Math.min(elapsed / HOVER_THRESHOLD_MS, 1);
                    setInteractionState(prev => ({ ...prev, progress }));

                    if (progress >= 1) {
                      setInteractionState({ status: 'dragging', targetId: closestId, targetType: 'sticker', progress: 0 });
                      dropStartTimeRef.current = now;
                      interactingIdRef.current = closestId;
                      setActiveStickerId(closestId);
                    }
                  }
                } else {
                  setInteractionState({ status: 'idle', targetId: null, targetType: 'sticker', progress: 0 });
                  hoverStartTimeRef.current = 0;
                }
            }
          }
        } else {
             if (currentState.status === 'dragging' && currentState.targetId && currentState.targetType === 'sticker') {
                 handleHandDrop(currentState.targetId);
             }
             setInteractionState({ status: 'idle', targetId: null, targetType: 'sticker', progress: 0 });
        }


        // --- 3. Face Tracking (Auto Positioning) ---
        if (faceResult && faceResult.faceLandmarks.length > 0) {
          setStickers(prevStickers => {
            return prevStickers.map(sticker => {
              if (interactingIdRef.current === sticker.id || sticker.anchorType === 'none' || currentState.status === 'dragging' || sticker.lifespan) {
                return sticker;
              }

              const anchorData = getAnchorData(faceResult, sticker.anchorType);
              if (anchorData) {
                lastFaceDataRef.current = anchorData; 
                
                const screenX = (1 - anchorData.x) * scaleX; 
                const screenY = anchorData.y * scaleY;
                const screenScale = anchorData.scale * scaleX; 

                return {
                  ...sticker,
                  x: screenX + sticker.anchorOffset.x,
                  y: screenY + sticker.anchorOffset.y,
                  scale: (screenScale / 100) * sticker.baseScale,
                  rotation: sticker.baseRotation - anchorData.rotation
                };
              }
              return sticker;
            });
          });
        }
      }
      requestRef.current = requestAnimationFrame(loop);
    };

    if (isVisionReady) {
      requestRef.current = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [isVisionReady, stickers]); 

  const cycleAnimalFace = () => {
    // 1. Find current face
    const faceAssets = ASSETS.filter(a => a.category === 'faces');
    setStickers(prev => {
        const currentFace = prev.find(s => s.category === 'faces');
        let nextIndex = 0;
        
        if (currentFace) {
            const currentIndex = faceAssets.findIndex(a => a.content === currentFace.content);
            nextIndex = (currentIndex + 1) % faceAssets.length;
        }

        const nextAsset = faceAssets[nextIndex];
        
        // Remove old face, add new one
        const others = prev.filter(s => s.category !== 'faces');
        
        // We need to spawn it relative to last known face position or screen center
        // If face is tracked, it will snap immediately next frame.
        const id = Date.now() + 'auto';
        const newFace: StickerItem = {
            id: id,
            type: nextAsset.type,
            content: nextAsset.content,
            category: nextAsset.category,
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
            scale: nextAsset.defaultScale,
            rotation: 0,
            anchorType: nextAsset.anchorType,
            anchorOffset: { x: 0, y: 0 },
            baseScale: nextAsset.defaultScale,
            baseRotation: 0
        };
        
        return [...others, newFace];
    });
  };

  const handleHandDrop = (id: string) => {
      interactingIdRef.current = null;
      setStickers(prev => {
        const sticker = prev.find(s => s.id === id);
        const faceData = lastFaceDataRef.current;
        if (sticker && faceData && videoRef.current) {
            const rect = videoRef.current.getBoundingClientRect();
            const faceX = (1 - faceData.x) * rect.width;
            const faceY = faceData.y * rect.height;
            const faceWidthPx = faceData.scale * rect.width;
            const newOffsetX = sticker.x - faceX;
            const newOffsetY = sticker.y - faceY;
            const newBaseScale = sticker.scale / (faceWidthPx / 100);

            return prev.map(s => s.id === id ? {
                ...s,
                anchorOffset: { x: newOffsetX, y: newOffsetY },
                baseScale: newBaseScale,
                baseRotation: sticker.rotation + faceData.rotation 
            } : s);
        }
        return prev;
      });
  };

  const handleAddSticker = (asset: Asset, spawnX?: number, spawnY?: number) => {
    const id = Date.now() + Math.random().toString();
    const newItem: StickerItem = {
      id: id,
      type: asset.type,
      content: asset.content,
      category: asset.category,
      x: spawnX || window.innerWidth / 2,
      y: spawnY || window.innerHeight / 2,
      scale: asset.defaultScale,
      rotation: 0,
      anchorType: asset.anchorType,
      anchorOffset: { x: 0, y: (asset.defaultOffsetY || 0) * 100 },
      baseScale: asset.defaultScale,
      baseRotation: 0
    };
    
    // If adding a face, remove existing faces
    if (asset.category === 'faces') {
        setStickers(prev => [...prev.filter(s => s.category !== 'faces'), newItem]);
    } else {
        setStickers(prev => [...prev, newItem]);
    }
    
    setActiveStickerId(newItem.id);
    return id;
  };

  const handleUpdateSticker = (id: string, updates: Partial<StickerItem>) => {
    setStickers(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleInteractionStart = (id: string) => { interactingIdRef.current = id; };
  const handleInteractionEnd = (id: string) => { handleHandDrop(id); };
  const handleDeleteSticker = (id: string) => {
    setStickers(prev => prev.filter(s => s.id !== id));
    if (activeStickerId === id) setActiveStickerId(null);
  };

  const captureCompositeImage = async (): Promise<string | null> => {
    if (!videoRef.current) return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const video = videoRef.current;
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.save();
    ctx.scale(-1, 1); 
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    for (const sticker of stickers) {
      if (sticker.lifespan) continue; // Don't capture temporary effects

      ctx.save();
      ctx.translate(sticker.x, sticker.y);
      ctx.rotate((sticker.rotation * Math.PI) / 180);
      ctx.scale(sticker.scale, sticker.scale);
      
      if (sticker.type === 'svg') {
        await new Promise<void>((resolve) => {
          const img = new Image();
          const svgBlob = new Blob([sticker.content], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          img.onload = () => {
            ctx.drawImage(img, -64, -64, 128, 128);
            URL.revokeObjectURL(url);
            resolve();
          };
          img.src = url;
        });
      } else {
        ctx.font = '80px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sticker.content, 0, 0);
      }
      ctx.restore();
    }
    return canvas.toDataURL('image/png');
  };

  const handleAIAnalysis = async () => {
    const permanentStickers = stickers.filter(s => !s.lifespan);
    if (permanentStickers.length === 0) {
      alert("Please add some items first!");
      return;
    }
    setIsAnalyzing(true);
    const imageData = await captureCompositeImage();
    if (imageData) {
      const result = await analyzeStyle(imageData);
      setAiResult(result);
      setShowResultModal(true);
    }
    setIsAnalyzing(false);
  };

  const renderCursor = () => {
      if (!handCursor.isDetected) return null;

      const size = 60;
      const stroke = 4;
      const radius = (size - stroke) / 2;
      const circumference = radius * 2 * Math.PI;
      const offset = circumference - (interactionState.progress * circumference);
      
      let color = 'white';
      if (interactionState.status === 'hovering') color = '#A855F7'; 
      if (interactionState.status === 'dragging') color = '#22C55E'; 
      if (handCursor.isResizing) color = '#3B82F6'; 
      if (handCursor.isOpenPalm) color = '#F472B6'; 

      return (
          <div 
             className="absolute pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
             style={{ left: handCursor.x, top: handCursor.y }}
          >
              <div className={`w-4 h-4 rounded-full shadow-lg transition-transform ${interactionState.status === 'dragging' ? 'scale-125' : ''}`} 
                   style={{ backgroundColor: color }}
              />
              
              {(interactionState.status === 'hovering' || interactionState.status === 'dragging' || handCursor.isResizing) && (
                  <svg className="absolute w-20 h-20 rotate-[-90deg]">
                      <circle stroke="rgba(255,255,255,0.3)" strokeWidth={stroke} fill="transparent" r={radius} cx="40" cy="40" />
                      <circle
                        stroke={color} strokeWidth={stroke} strokeDasharray={circumference}
                        strokeDashoffset={interactionState.status === 'dragging' ? 0 : (handCursor.isResizing ? 0 : offset)} 
                        strokeLinecap="round" fill="transparent" r={radius} cx="40" cy="40"
                        className="transition-all duration-100 ease-linear"
                      />
                  </svg>
              )}
              
              {/* Context Labels */}
              <div className="absolute top-10 flex flex-col items-center gap-1">
                {handCursor.fingerCount === 3 && (
                    <span className="bg-red-500/80 text-white text-[10px] px-2 py-1 rounded-md whitespace-nowrap backdrop-blur border border-white/20 flex items-center gap-1">
                        <Trash2 size={10} /> Swipe to Clear
                    </span>
                )}
                {handCursor.fingerCount === 4 && (
                    <span className="bg-yellow-500/80 text-white text-[10px] px-2 py-1 rounded-md whitespace-nowrap backdrop-blur border border-white/20 flex items-center gap-1">
                        <RotateCcw size={10} /> Swipe to Swap
                    </span>
                )}
                {handCursor.isResizing && (
                    <span className="bg-blue-500/80 text-white text-[10px] px-2 py-1 rounded-md whitespace-nowrap backdrop-blur border border-white/20 flex items-center gap-1">
                        <Scissors size={10} /> Scale
                    </span>
                )}
                {handCursor.isOpenPalm && (
                    <span className="bg-pink-500/80 text-white text-[10px] px-2 py-1 rounded-md whitespace-nowrap backdrop-blur border border-white/20 flex items-center gap-1">
                        <Sparkles size={10} /> Magic
                    </span>
                )}
              </div>
          </div>
      );
  };

  return (
    <div className="relative w-full h-[100dvh] bg-black overflow-hidden flex flex-col select-none touch-none">
      <div className="absolute inset-0 z-0">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100" />
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-black/20 via-transparent to-black/60" />
      </div>

      {error && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-8 text-center">
          <div className="bg-gray-800 p-6 rounded-2xl border border-red-500/50 max-w-sm">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Camera Error</h2>
            <p className="text-gray-400">{error}</p>
          </div>
        </div>
      )}

      {!isVisionReady && !error && (
         <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-black/50 text-white px-4 py-2 rounded-full backdrop-blur text-sm flex items-center gap-2">
            <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
            Initializing Vision AI...
         </div>
      )}

      <StickerCanvas 
        stickers={stickers}
        activeId={activeStickerId}
        onUpdate={handleUpdateSticker}
        onSelect={setActiveStickerId}
        onDelete={handleDeleteSticker}
        onInteractionStart={handleInteractionStart}
        onInteractionEnd={handleInteractionEnd}
      />

      {renderCursor()}

      <div className="absolute top-0 left-0 right-0 p-6 z-40 flex justify-between items-start pointer-events-none">
        <div className="pointer-events-auto bg-black/40 backdrop-blur-xl px-5 py-2 rounded-full border border-white/10 shadow-lg">
          <h1 className="font-bold text-base tracking-widest text-white">
            AR<span className="text-purple-400">FIT</span>
          </h1>
        </div>

        <button 
          onClick={handleAIAnalysis}
          disabled={isAnalyzing}
          className="pointer-events-auto group flex items-center gap-2 bg-white text-black hover:bg-purple-400 transition-colors px-6 py-3 rounded-full shadow-xl shadow-purple-900/20 active:scale-95 disabled:opacity-50"
        >
          {isAnalyzing ? (
            <div className="animate-spin h-5 w-5 border-2 border-black border-t-transparent rounded-full" />
          ) : (
            <Camera size={20} className="group-hover:rotate-12 transition-transform" />
          )}
          <span className="font-bold text-sm uppercase tracking-wide">Snap & Rate</span>
        </button>
      </div>

      {stickers.length === 0 && !error && isVisionReady && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none text-center w-full px-10">
          <div className="flex justify-center gap-4 mb-4">
             <ScanFace className="w-10 h-10 text-white/50 animate-pulse" />
             <Hand className="w-10 h-10 text-white/50 animate-bounce delay-100" />
          </div>
          <p className="text-white/80 font-light text-lg drop-shadow-md">
            Select an Animal Face!
          </p>
          <p className="text-white/40 text-sm mt-2 space-y-1">
            <b className="text-pink-400">Open Hand (5)</b> - Cast Magic<br/>
            <b className="text-blue-400">Pinch (2)</b> - Resize Items<br/>
            <b className="text-red-400">Swipe (3)</b> - Clear Screen<br/>
            <b className="text-yellow-400">Swipe (4)</b> - Swap Animal
          </p>
        </div>
      )}

      {showResultModal && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-gray-900 border border-purple-500/30 w-full max-w-md p-6 rounded-[2rem] shadow-2xl relative overflow-hidden">
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-purple-600/20 rounded-full blur-[100px]" />
            <button 
              onClick={() => setShowResultModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white bg-gray-800/50 p-2 rounded-full hover:bg-gray-700 transition-colors z-10"
            >
              <X size={20} />
            </button>
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-900/50">
                  <Sparkles size={24} className="text-white" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-white">Style Check</h3>
                  <p className="text-purple-400 text-xs font-medium uppercase tracking-wider">Analysis Complete</p>
                </div>
              </div>
              <div className="bg-white/5 rounded-2xl p-5 mb-6 text-gray-100 text-lg leading-relaxed border border-white/5 font-light">
                "{aiResult}"
              </div>
              <button 
                onClick={() => setShowResultModal(false)}
                className="w-full bg-white text-black font-bold py-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                Try Another Look
              </button>
            </div>
          </div>
        </div>
      )}

      <AssetSelector 
        onSelect={(asset) => handleAddSticker(asset)}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
      />
    </div>
  );
};

export default App;
