import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Gamepad2, Trophy, Fingerprint, Hand } from 'lucide-react';
import { Asset, ASSETS, StickerItem, Category, CoinItem, COIN_SVG } from './types';
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
const SWIPE_VELOCITY_THRESHOLD = 0.015; // Slightly more sensitive
const GESTURE_COOLDOWN_MS = 800;
const FACE_SWIPE_RADIUS_MIN = 120; // Min px distance

// Effect Spawn
const EFFECT_LIFESPAN = 3000; // Stay 2s + Fade 1s
const EFFECT_FADE_DURATION = 1000; // Last 1000ms is fading
const EFFECT_SPAWN_RATE = 150; // Spawn interval in ms

// Game Constants
const COIN_SPAWN_RATE_MS = 800;
const BASE_COIN_SPEED = 5;
const FAST_COIN_SPEED = 9; // Speed up
const COIN_RADIUS = 40;
const AVATAR_COLLISION_RADIUS = 80;
const POINTS_PER_COIN = 10;
const SPEED_UP_THRESHOLD = 150;
const WIN_SCORE_THRESHOLD = 400;

export const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null); // Use ref for cleanup access
  const [error, setError] = useState<string | null>(null);
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [activeStickerId, setActiveStickerId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category>('faces');
  
  // Game State
  const [isPlaying, setIsPlaying] = useState(false);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState<CoinItem[]>([]);
  const [showWinModal, setShowWinModal] = useState(false);

  // Refs for synchronous loop access
  const scoreRef = useRef(0);
  const lastCoinSpawnTimeRef = useRef<number>(0);
  const coinsRef = useRef<CoinItem[]>([]); // To avoid dependency cycle in loop
  const stickersRef = useRef<StickerItem[]>([]); // To access stickers inside loop
  const lastEffectSpawnTimeRef = useRef<number>(0);

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
  const lastGestureTimeRef = useRef<number>(0);
  const lastHandPosRef = useRef<{x: number, y: number} | null>(null);
  const interactionStateRef = useRef(interactionState); 
  
  useEffect(() => { interactionStateRef.current = interactionState; }, [interactionState]);
  useEffect(() => { coinsRef.current = coins; }, [coins]); // Sync ref
  useEffect(() => { stickersRef.current = stickers; }, [stickers]); // Sync ref

  // AI Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  // Helpers
  const handleUpdateSticker = (id: string, updates: Partial<StickerItem>) => {
    setStickers(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleDeleteSticker = (id: string) => {
    setStickers(prev => prev.filter(s => s.id !== id));
    if (activeStickerId === id) setActiveStickerId(null);
  };

  const handleSelectAsset = (asset: Asset) => {
    const newSticker: StickerItem = {
      id: `${asset.id}-${Date.now()}`,
      type: asset.type,
      content: asset.content,
      category: asset.category,
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      scale: asset.defaultScale,
      rotation: 0,
      anchorType: asset.anchorType,
      anchorOffset: { x: 0, y: asset.defaultOffsetY || 0 },
      baseScale: asset.defaultScale,
      baseRotation: 0
    };
    
    setStickers(prev => {
        if (asset.category === 'faces') {
            return [...prev.filter(s => s.category !== 'faces'), newSticker];
        }
        return [...prev, newSticker];
    });
  };

  const cycleAnimalFace = (effectX?: number, effectY?: number) => {
    const faceAssets = ASSETS.filter(a => a.category === 'faces');
    setStickers(prev => {
      const currentFace = prev.find(s => s.category === 'faces');
      let nextIndex = 0;
      if (currentFace) {
        // Match by content since ID changes
        const currentIndex = faceAssets.findIndex(a => a.content === currentFace.content);
        nextIndex = (currentIndex + 1) % faceAssets.length;
      }
      const nextAsset = faceAssets[nextIndex];
      
      const others = prev.filter(s => s.category !== 'faces');
      const newFace: StickerItem = {
        id: `face-${Date.now()}`,
        type: nextAsset.type,
        content: nextAsset.content,
        category: 'faces',
        x: 0, y: 0, // Will be snapped by anchor logic
        scale: nextAsset.defaultScale,
        rotation: 0,
        anchorType: nextAsset.anchorType,
        anchorOffset: { x: 0, y: nextAsset.defaultOffsetY || 0 },
        baseScale: nextAsset.defaultScale,
        baseRotation: 0
      };

      return [...others, newFace];
    });
  };

  const handleHandDrop = (id: string) => {
    interactingIdRef.current = null;
    setActiveStickerId(null);
  };

  const handleAnalyze = async () => {
    if (!videoRef.current) return;
    setIsAnalyzing(true);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0);
            const base64 = canvas.toDataURL('image/jpeg');
            const result = await analyzeStyle(base64);
            setAiResult(result);
            setShowResultModal(true);
        }
    } catch (e) {
        console.error(e);
    }
    setIsAnalyzing(false);
  };

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
        streamRef.current = mediaStream;
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
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // Main Tracking Loop (Face + Hand + Game)
  useEffect(() => {
    const loop = () => {
      if (videoRef.current && isVisionReady && videoRef.current.readyState >= 2) {
        const now = performance.now();
        const faceResult = detectFace(videoRef.current, now);
        const handResult = detectHands(videoRef.current, now);
        
        const rect = videoRef.current.getBoundingClientRect();
        const scaleX = rect.width;
        const scaleY = rect.height;

        // --- GAME LOOP ---
        if (isPlaying) {
            if (scoreRef.current >= WIN_SCORE_THRESHOLD) {
                setIsPlaying(false);
                setShowWinModal(true);
                setCoins([]);
                return; 
            }

            if (now - lastCoinSpawnTimeRef.current > COIN_SPAWN_RATE_MS) {
                const spawnX = Math.random() * (scaleX - 100) + 50;
                const newCoin: CoinItem = {
                    id: `coin-${now}`,
                    x: spawnX,
                    y: -50,
                    scale: 1,
                    value: POINTS_PER_COIN,
                    collected: false
                };
                setCoins(prev => [...prev, newCoin]);
                lastCoinSpawnTimeRef.current = now;
            }

            let avatarX = -1000;
            let avatarY = -1000;
            if (faceResult && faceResult.faceLandmarks.length > 0) {
                 const landmarks = faceResult.faceLandmarks[0];
                 const noseTip = landmarks[1];
                 avatarX = (1 - noseTip.x) * scaleX;
                 avatarY = noseTip.y * scaleY;
            }

            const currentSpeed = scoreRef.current >= SPEED_UP_THRESHOLD ? FAST_COIN_SPEED : BASE_COIN_SPEED;

            setCoins(prevCoins => {
                const nextCoins: CoinItem[] = [];
                let scoreIncrement = 0;

                prevCoins.forEach(coin => {
                    if (coin.collected) return;
                    const nextY = coin.y + currentSpeed;
                    const dx = coin.x - avatarX;
                    const dy = nextY - avatarY;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < (COIN_RADIUS + AVATAR_COLLISION_RADIUS)) {
                        scoreIncrement += coin.value;
                    } else if (nextY <= scaleY + 50) {
                        nextCoins.push({ ...coin, y: nextY });
                    }
                });
                
                if (scoreIncrement > 0) {
                    scoreRef.current += scoreIncrement;
                    setScore(scoreRef.current);
                }
                
                return nextCoins;
            });
        }

        // --- 0. Lifecycle Management ---
        setStickers(prev => {
          const alive = prev.filter(s => {
             if (!s.lifespan || !s.createdAt) return true;
             // Remove dead stickers
             return (now - s.createdAt) < s.lifespan;
          });
          
          return alive.map(s => {
             if (s.lifespan && s.createdAt) {
                const age = now - s.createdAt;
                const timeRemaining = s.lifespan - age;
                // Fade out in the last EFFECT_FADE_DURATION ms
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
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          const middleTip = landmarks[12];
          const ringTip = landmarks[16];
          const pinkyTip = landmarks[20];
          
          const indexMCP = landmarks[5];
          const middleMCP = landmarks[9];
          const ringMCP = landmarks[13];
          const pinkyMCP = landmarks[17];

          cursorX = (1 - indexTip.x) * scaleX;
          cursorY = indexTip.y * scaleY;
          handDetected = true;

          const isIndexExt = indexTip.y < indexMCP.y;
          const isMiddleExt = middleTip.y < middleMCP.y;
          const isRingExt = ringTip.y < ringMCP.y;
          const isPinkyExt = pinkyTip.y < pinkyMCP.y;
          const isThumbExt = Math.abs(thumbTip.x - indexMCP.x) > 0.05;

          fingerCount = (isThumbExt?1:0) + (isIndexExt?1:0) + (isMiddleExt?1:0) + (isRingExt?1:0) + (isPinkyExt?1:0);

          const distX = thumbTip.x - indexTip.x;
          const distY = thumbTip.y - indexTip.y;
          pinchDistance = Math.sqrt(distX * distX + distY * distY);
          
          if (pinchDistance < RESIZE_START_THRESHOLD) {
             isResizingGesture = true;
          }
          if (fingerCount === 5) {
            isOpenPalm = true;
          }
          
          setHandCursor({ x: cursorX, y: cursorY, isDetected: true, isResizing: isResizingGesture, isOpenPalm, fingerCount });

          const currentHandX = landmarks[9].x; 
          let isSwipe = false;

          if (lastHandPosRef.current && (now - lastGestureTimeRef.current > GESTURE_COOLDOWN_MS) && !isPlaying) {
              const dx = currentHandX - lastHandPosRef.current.x; 
              isSwipe = Math.abs(dx) > SWIPE_VELOCITY_THRESHOLD;
              
              if (isSwipe) {
                  // Only reset 3-finger swipe
                  if (fingerCount === 3 && isIndexExt && isMiddleExt && isRingExt) {
                      setStickers([]);
                      setActiveStickerId(null);
                      lastGestureTimeRef.current = now;
                  }
                  
                  // "Bian Lian" - Face Change Gesture
                  // Requirement: 5 Fingers + Swipe + Over Face + Face Avatar Selected
                  const hasFaceSticker = stickersRef.current.some(s => s.category === 'faces');
                  
                  if (fingerCount === 5 && hasFaceSticker && lastFaceDataRef.current && faceResult && faceResult.faceLandmarks.length > 0) {
                      const faceX = (1 - lastFaceDataRef.current.x) * scaleX;
                      const faceY = lastFaceDataRef.current.y * scaleY;
                      
                      // Dynamic swipe radius based on face size for better UX
                      const faceWidthPx = lastFaceDataRef.current.scale * scaleX;
                      const swipeRadius = Math.max(FACE_SWIPE_RADIUS_MIN, faceWidthPx * 1.5);

                      const distToFace = Math.hypot(cursorX - faceX, cursorY - faceY);

                      if (distToFace < swipeRadius) {
                          cycleAnimalFace(faceX, faceY);
                          lastGestureTimeRef.current = now;
                      }
                  }
              }
          }

          lastHandPosRef.current = { x: currentHandX, y: landmarks[9].y };
          
          // --- Magic Effect Spawn Logic ---
          if (isOpenPalm && !isPlaying && (now - lastEffectSpawnTimeRef.current > EFFECT_SPAWN_RATE)) {
              // 1. Check if we have an animal face active
              const activeFace = stickersRef.current.find(s => s.category === 'faces');
              if (activeFace) {
                  // 2. Find matching asset to get effects
                  // activeFace.content is the SVG string, so we match by content
                  const faceAsset = ASSETS.find(a => a.content === activeFace.content);
                  
                  if (faceAsset && faceAsset.effectItems && faceAsset.effectItems.length > 0) {
                      // 3. Pick random effect item
                      const randomItem = faceAsset.effectItems[Math.floor(Math.random() * faceAsset.effectItems.length)];
                      
                      // 4. Create Effect Sticker
                      const newEffect: StickerItem = {
                          id: `fx-${now}`,
                          type: 'emoji',
                          content: randomItem,
                          category: 'accessories', // Dummy category
                          x: cursorX + (Math.random() - 0.5) * 40,
                          y: cursorY + (Math.random() - 0.5) * 40,
                          scale: 0.8 + Math.random() * 0.4,
                          rotation: Math.random() * 360,
                          opacity: 1,
                          anchorType: 'none',
                          anchorOffset: { x: 0, y: 0 },
                          baseScale: 1,
                          baseRotation: 0,
                          createdAt: now,
                          lifespan: EFFECT_LIFESPAN
                      };
                      
                      setStickers(prev => [...prev, newEffect]);
                      lastEffectSpawnTimeRef.current = now;
                  }
              }
          }

        } else {
          setHandCursor(prev => ({ ...prev, isDetected: false, isResizing: false, isOpenPalm: false, fingerCount: 0 }));
          lastHandPosRef.current = null;
        }

        // --- 2. Interaction Logic ---
        const currentState = interactionStateRef.current;
        
        if (handDetected && !isPlaying) {
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
          else if (currentState.status === 'dragging' && currentState.targetId && currentState.targetType === 'sticker') {
            setStickers(prev => prev.map(s => {
              if (s.id === currentState.targetId) {
                return { ...s, x: cursorX, y: cursorY };
              }
              return s;
            }));

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
            const element = document.elementFromPoint(cursorX, cursorY);
            let targetId: string | null = null;
            let targetType: 'sticker' | 'button_asset' | 'button_cat' = 'sticker';

            if (element) {
               const btnAsset = element.closest('[id^="asset-btn-"]');
               const btnCat = element.closest('[id^="cat-btn-"]');
               if (btnAsset) {
                   targetId = btnAsset.id.replace('asset-btn-', '');
                   targetType = 'button_asset';
               } else if (btnCat) {
                   targetId = btnCat.id.replace('cat-btn-', '');
                   targetType = 'button_cat';
               }
            }

            if (!targetId) {
                for (let i = stickersRef.current.length - 1; i >= 0; i--) {
                    const s = stickersRef.current[i];
                    const dist = Math.hypot(s.x - cursorX, s.y - cursorY);
                    if (dist < INTERACTION_RADIUS) {
                        targetId = s.id;
                        targetType = 'sticker';
                        break;
                    }
                }
            }

            if (targetId) {
                if (interactionStateRef.current.targetId === targetId && interactionStateRef.current.status === 'hovering') {
                    const elapsed = now - hoverStartTimeRef.current;
                    const threshold = (targetType === 'sticker') ? HOVER_THRESHOLD_MS : BUTTON_HOVER_THRESHOLD_MS;
                    const progress = Math.min(elapsed / threshold, 1);
                    
                    setInteractionState({ status: 'hovering', targetId, targetType, progress });

                    if (progress >= 1) {
                        if (targetType === 'sticker') {
                             interactingIdRef.current = targetId;
                             setInteractionState({ status: 'dragging', targetId, targetType, progress: 0 });
                             setActiveStickerId(targetId);
                        } else if (targetType === 'button_asset') {
                             const asset = ASSETS.find(a => a.id === targetId);
                             if (asset) handleSelectAsset(asset);
                             setInteractionState({ status: 'idle', targetId: null, targetType: 'sticker', progress: 0 });
                        } else if (targetType === 'button_cat') {
                             setSelectedCategory(targetId as Category);
                             setInteractionState({ status: 'idle', targetId: null, targetType: 'sticker', progress: 0 });
                        }
                        hoverStartTimeRef.current = 0;
                    }
                } else if (interactionStateRef.current.targetId !== targetId) {
                    hoverStartTimeRef.current = now;
                    setInteractionState({ status: 'hovering', targetId, targetType, progress: 0 });
                }
            } else {
                setInteractionState({ status: 'idle', targetId: null, targetType: 'sticker', progress: 0 });
                hoverStartTimeRef.current = 0;
            }
          }
        }

        // --- 3. Face Anchoring Update ---
        if (faceResult && faceResult.faceLandmarks.length > 0) {
             const anchorDataMap = {
                 head: getAnchorData(faceResult, 'head'),
                 eyes: getAnchorData(faceResult, 'eyes'),
                 face: getAnchorData(faceResult, 'face'),
                 body: getAnchorData(faceResult, 'body'),
             };
             
             if (anchorDataMap.face) lastFaceDataRef.current = anchorDataMap.face;

             setStickers(prev => prev.map(s => {
                 if (s.id === interactingIdRef.current || (interactionStateRef.current.status === 'dragging' && interactionStateRef.current.targetId === s.id)) {
                     return s;
                 }
                 if (s.anchorType !== 'none' && anchorDataMap[s.anchorType]) {
                     const data = anchorDataMap[s.anchorType];
                     if (data) {
                         const rawX = (1 - data.x) * scaleX;
                         const rawY = data.y * scaleY;
                         
                         // Determine target size in pixels
                         // data.scale is normalized face width (0-1)
                         // scaleX is screen width
                         // 128 is the base dimensions of the sticker container (w-32)
                         const faceWidthPx = data.scale * scaleX;
                         const targetScale = (faceWidthPx / 128) * s.baseScale;

                         return {
                             ...s,
                             x: rawX + (s.anchorOffset.x * scaleX * 0.1),
                             y: rawY + (s.anchorOffset.y * scaleY * 0.1),
                             scale: targetScale,
                             rotation: s.baseRotation + data.rotation
                         };
                     }
                 }
                 return s;
             }));
        }
      }
      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [isPlaying, isVisionReady]);

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden font-sans">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]"
      />

      {/* Overlays */}
      {!isPlaying && (
        <>
          <AssetSelector 
            onSelect={handleSelectAsset} 
            selectedCategory={selectedCategory} 
            onCategoryChange={setSelectedCategory}
          />
          <StickerCanvas 
            stickers={stickers}
            activeId={activeStickerId}
            onUpdate={handleUpdateSticker}
            onSelect={setActiveStickerId}
            onDelete={handleDeleteSticker}
            onInteractionStart={(id) => interactingIdRef.current = id}
            onInteractionEnd={(id) => interactingIdRef.current = null}
          />
        </>
      )}

      {/* Game Mode - Show Stickers (Face Only essentially) + Coins */}
      {isPlaying && (
          <>
            <StickerCanvas 
                stickers={stickers}
                activeId={null}
                onUpdate={() => {}} // No interaction in game
                onSelect={() => {}}
                onDelete={() => {}}
                onInteractionStart={() => {}}
                onInteractionEnd={() => {}}
            />
            {coins.map(coin => (
                <div 
                key={coin.id}
                className="absolute pointer-events-none"
                style={{ left: coin.x - 40, top: coin.y - 40, width: 80, height: 80 }}
                >
                <div dangerouslySetInnerHTML={{ __html: COIN_SVG }} />
                </div>
            ))}
          </>
      )}

      {/* HUD */}
      <div className="absolute top-4 left-4 z-50 flex flex-col gap-4">
          {!isPlaying && (
            <div className="bg-black/40 backdrop-blur-md p-4 rounded-xl border border-white/10 text-white max-w-xs">
                <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
                   Magic Mirror
                </h1>
                <p className="text-sm opacity-80 mb-2">
                    <Hand className="inline w-4 h-4 mr-1"/> Use gestures or touch.
                </p>
                <div className="flex gap-2 text-xs text-gray-300 flex-wrap">
                    <span className="bg-white/10 px-2 py-1 rounded">☝️ Point & Wait to Select</span>
                    <span className="bg-white/10 px-2 py-1 rounded">👌 Pinch to Resize</span>
                    <span className="bg-white/10 px-2 py-1 rounded">👋 Swipe Face with 5 Fingers</span>
                </div>
            </div>
          )}

          {isPlaying && (
            <div className="bg-yellow-500/20 backdrop-blur-md p-4 rounded-xl border border-yellow-500/50 text-yellow-300">
               <div className="flex items-center gap-2 text-2xl font-bold">
                   <Trophy /> {score}
               </div>
               <div className="text-xs mt-1">Goal: {WIN_SCORE_THRESHOLD}</div>
            </div>
          )}
      </div>

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4">
          <button 
             onClick={() => {
                setIsPlaying(!isPlaying);
                if (!isPlaying) {
                    // START GAME LOGIC
                    setScore(0);
                    scoreRef.current = 0;
                    setCoins([]);
                    // Keep only face stickers for the game
                    setStickers(prev => prev.filter(s => s.category === 'faces'));
                }
             }}
             className={`p-4 rounded-full shadow-lg transition-all active:scale-95 ${isPlaying ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
          >
             {isPlaying ? <X size={32} className="text-white"/> : <Gamepad2 size={32} className="text-white"/>}
          </button>

          {!isPlaying && (
            <>
                <button 
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="p-4 bg-purple-600 hover:bg-purple-700 rounded-full text-white shadow-lg transition-all active:scale-95 disabled:opacity-50"
                >
                    {isAnalyzing ? <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div> : <Sparkles size={32} />}
                </button>
                <button 
                    onClick={() => { setStickers([]); setActiveStickerId(null); }}
                    className="p-4 bg-gray-700 hover:bg-gray-800 rounded-full text-white shadow-lg transition-all active:scale-95"
                >
                    <X size={32} />
                </button>
            </>
          )}
      </div>

      {/* Hand Cursor */}
      {handCursor.isDetected && !isPlaying && (
          <div 
            className="absolute z-[60] pointer-events-none transition-transform duration-75"
            style={{ 
                left: handCursor.x, 
                top: handCursor.y,
                transform: `translate(-50%, -50%) scale(${interactionState.progress > 0 ? 1 + interactionState.progress : 1})`
            }}
          >
             <div className={`
                w-8 h-8 rounded-full border-2 flex items-center justify-center
                ${interactionState.status === 'hovering' ? 'border-yellow-400 bg-yellow-400/20' : 
                  interactionState.status === 'dragging' ? 'border-blue-500 bg-blue-500/30 scale-125' : 'border-white bg-white/30'}
             `}>
                {interactionState.status === 'dragging' ? <Fingerprint size={16} className="text-blue-200"/> : <div className="w-1 h-1 bg-white rounded-full"/>}
             </div>
             
             {/* Progress Ring */}
             {interactionState.progress > 0 && interactionState.status === 'hovering' && (
                 <svg className="absolute top-0 left-0 w-full h-full -rotate-90">
                     <circle 
                        cx="16" cy="16" r="14" 
                        fill="none" stroke="currentColor" strokeWidth="2" 
                        className="text-yellow-400"
                        strokeDasharray={88}
                        strokeDashoffset={88 * (1 - interactionState.progress)}
                     />
                 </svg>
             )}
          </div>
      )}

      {/* AI Result Modal */}
      {showResultModal && (
         <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
             <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl max-w-sm w-full shadow-2xl relative">
                 <button onClick={() => setShowResultModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white">
                     <X size={24} />
                 </button>
                 <div className="flex items-center gap-3 mb-4 text-purple-400">
                     <Sparkles size={24} />
                     <h3 className="text-xl font-bold">Stylist AI Says...</h3>
                 </div>
                 <p className="text-gray-200 text-lg leading-relaxed">
                    {aiResult || "Looking fabulous!"}
                 </p>
             </div>
         </div>
      )}
      
      {/* Win Modal */}
      {showWinModal && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
             <div className="bg-gradient-to-br from-yellow-600 to-yellow-800 p-8 rounded-2xl max-w-sm w-full shadow-2xl text-center border border-yellow-400/30">
                 <Trophy size={64} className="mx-auto text-yellow-200 mb-4" />
                 <h2 className="text-3xl font-bold text-white mb-2">YOU WIN!</h2>
                 <p className="text-yellow-100 mb-6">Score: {score}</p>
                 <button 
                   onClick={() => setShowWinModal(false)}
                   className="bg-white text-yellow-900 px-8 py-3 rounded-full font-bold hover:bg-yellow-100 transition-colors"
                 >
                    Play Again
                 </button>
             </div>
        </div>
      )}
      
      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-900/90 text-white p-6 rounded-xl max-w-md text-center">
            <h3 className="text-xl font-bold mb-2">Camera Error</h3>
            <p>{error}</p>
        </div>
      )}
    </div>
  );
};