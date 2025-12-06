
import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, AlertCircle, X, Camera, ScanFace, Hand, Fingerprint, Scissors, Trash2, RotateCcw, Gamepad2, Trophy, ArrowRight } from 'lucide-react';
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
const SWIPE_VELOCITY_THRESHOLD = 0.02; // Normalized coord diff per frame
const GESTURE_COOLDOWN_MS = 1000;

// Effect Spawn
const EFFECT_COOLDOWN_MS = 200; 
const EFFECT_LIFESPAN = 2000; // 2 seconds
const EFFECT_FADE_DURATION = 500; // Last 500ms

// Game Constants
const COIN_SPAWN_RATE_MS = 800;
const BASE_COIN_SPEED = 5;
const FAST_COIN_SPEED = 9; // Speed up
const COIN_RADIUS = 40;
const AVATAR_COLLISION_RADIUS = 80;
const POINTS_PER_COIN = 10;
const SPEED_UP_THRESHOLD = 150;
const WIN_SCORE_THRESHOLD = 400;

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<number>(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
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
  useEffect(() => { coinsRef.current = coins; }, [coins]); // Sync ref

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
            // Check Win Condition
            if (scoreRef.current >= WIN_SCORE_THRESHOLD) {
                setIsPlaying(false);
                setShowWinModal(true);
                setCoins([]);
                return; // Stop loop this frame
            }

            // 1. Spawn Coins
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
                // We use setCoins functional update but also need to keep ref in sync
                setCoins(prev => [...prev, newCoin]);
                lastCoinSpawnTimeRef.current = now;
            }

            // 2. Find Avatar Position for Collision
            let avatarX = -1000;
            let avatarY = -1000;
            if (faceResult && faceResult.faceLandmarks.length > 0) {
                 const landmarks = faceResult.faceLandmarks[0];
                 const noseTip = landmarks[1];
                 avatarX = (1 - noseTip.x) * scaleX;
                 avatarY = noseTip.y * scaleY;
            }

            // 3. Update Coins & Check Collision
            // We read from ref for speed but update state
            const currentSpeed = scoreRef.current >= SPEED_UP_THRESHOLD ? FAST_COIN_SPEED : BASE_COIN_SPEED;

            setCoins(prevCoins => {
                const nextCoins: CoinItem[] = [];
                let scoreIncrement = 0;

                prevCoins.forEach(coin => {
                    if (coin.collected) return;

                    // Move down
                    const nextY = coin.y + currentSpeed;

                    // Check Collision
                    const dx = coin.x - avatarX;
                    const dy = nextY - avatarY;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < (COIN_RADIUS + AVATAR_COLLISION_RADIUS)) {
                        scoreIncrement += coin.value;
                        // It's collected, don't add to nextCoins
                    } 
                    else if (nextY <= scaleY + 50) {
                        // Keep if on screen
                        nextCoins.push({ ...coin, y: nextY });
                    }
                });
                
                if (scoreIncrement > 0) {
                    scoreRef.current += scoreIncrement;
                    setScore(scoreRef.current); // Sync UI
                }
                
                return nextCoins;
            });
        }

        // --- 0. Lifecycle Management (Fade & Destroy Effects) ---
        setStickers(prev => {
          const alive = prev.filter(s => {
             if (!s.lifespan || !s.createdAt) return true;
             return (now - s.createdAt) < s.lifespan;
          });
          
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

          // --- GESTURE SWIPE LOGIC ---
          const currentHandX = landmarks[9].x; 
          if (lastHandPosRef.current && (now - lastGestureTimeRef.current > GESTURE_COOLDOWN_MS) && !isPlaying) {
              const dx = currentHandX - lastHandPosRef.current.x; 
              const isSwipe = Math.abs(dx) > SWIPE_VELOCITY_THRESHOLD;
              
              if (isSwipe) {
                  if (fingerCount === 3 && isIndexExt && isMiddleExt && isRingExt) {
                      setStickers([]);
                      setActiveStickerId(null);
                      lastGestureTimeRef.current = now;
                  }
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

        // --- 2. Interaction Logic (Only when not playing game) ---
        const currentState = interactionStateRef.current;
        
        if (handDetected && !isPlaying) {
          // A. ANIMAL EFFECT SPAWNING (Open Palm)
          if (isOpenPalm && (now - lastEffectSpawnTimeRef.current > EFFECT_COOLDOWN_MS)) {
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
                            scale: 2.0, 
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
            // MODE: HOVERING / SELECTION
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
                const interactableStickers = stickers.filter(s => !s.lifespan);

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
        } 
        else if (!handDetected) {
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
  }, [isVisionReady, isPlaying]); // Removed unstable dependencies from loop

  // Game Logic
  const handleStartGame = () => {
    const hasFace = stickers.some(s => s.category === 'faces');
    if (!hasFace) {
        alert("Please select an animal avatar first!");
        return;
    }
    setScore(0);
    scoreRef.current = 0;
    setCoins([]);
    setIsPlaying(true);
    setShowWinModal(false);
  };

  const handleStopGame = () => {
      setIsPlaying(false);
      setCoins([]);
  };
  
  const handleRestart = () => {
      handleStopGame();
      setShowWinModal(false);
  };

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
      if (!handCursor.isDetected || isPlaying) return null;

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

      {/* RENDER GAME COINS */}
      {isPlaying && (
         <div className="absolute inset-0 z-30 pointer-events-none">
            {coins.map(coin => (
                <div 
                    key={coin.id} 
                    className="absolute w-20 h-20 transition-transform duration-75 ease-linear"
                    style={{ 
                        transform: `translate(${coin.x - 40}px, ${coin.y - 40}px)`,
                    }}
                >
                     <div dangerouslySetInnerHTML={{ __html: COIN_SVG }} className="w-full h-full drop-shadow-md" />
                </div>
            ))}
            
            {/* Game Score UI */}
            <div className="absolute top-24 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-yellow-500/90 text-black px-6 py-3 rounded-full shadow-lg border-2 border-white">
                <Trophy size={24} strokeWidth={2.5} />
                <span className="text-2xl font-black font-mono tracking-wider">{score}</span>
                <span className="text-[10px] uppercase font-bold opacity-60 ml-1">/ {WIN_SCORE_THRESHOLD}</span>
            </div>
            
            <button 
                onClick={handleStopGame}
                className="absolute top-6 right-6 pointer-events-auto bg-red-600 text-white px-4 py-2 rounded-full font-bold hover:bg-red-500 shadow-lg"
            >
                Quit Game
            </button>
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

        {!isPlaying && (
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
        )}
      </div>

      {/* START GAME BUTTON (Visible when face selected and not playing) */}
      {!isPlaying && stickers.some(s => s.category === 'faces') && (
          <div className="absolute bottom-10 right-10 z-50 animate-in slide-in-from-bottom-10 fade-in duration-500">
              <button 
                  onClick={handleStartGame}
                  className="group relative flex items-center gap-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-black px-8 py-4 rounded-full shadow-[0_0_20px_rgba(234,179,8,0.6)] hover:scale-105 active:scale-95 transition-all"
              >
                  <Gamepad2 size={28} strokeWidth={2.5} />
                  <div className="text-left">
                      <div className="font-black text-lg leading-none uppercase">Start Game</div>
                      <div className="text-[10px] font-bold opacity-80 uppercase tracking-widest">Catch Coins</div>
                  </div>
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                  
                  {/* Ping Animation */}
                  <span className="absolute -top-1 -right-1 flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-white"></span>
                  </span>
              </button>
          </div>
      )}

      {/* WIN MODAL */}
      {showWinModal && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-gradient-to-b from-yellow-600/20 to-gray-900 border border-yellow-500/30 w-full max-w-sm p-8 rounded-[2rem] shadow-2xl relative overflow-hidden text-center">
             <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                 <div className="absolute top-0 left-1/4 w-32 h-32 bg-yellow-500/20 rounded-full blur-[60px]" />
             </div>
             
             <Trophy size={64} className="text-yellow-400 mx-auto mb-4 drop-shadow-[0_0_15px_rgba(250,204,21,0.5)]" />
             <h2 className="text-3xl font-black text-white mb-1 uppercase italic">Victory!</h2>
             <p className="text-yellow-200/80 mb-6 font-medium">You collected all the coins!</p>
             
             <div className="bg-black/40 rounded-xl p-4 mb-6 border border-white/10">
                 <div className="text-sm text-gray-400 uppercase tracking-widest mb-1">Final Score</div>
                 <div className="text-4xl font-mono font-bold text-white">{scoreRef.current}</div>
             </div>
             
             <button 
               onClick={handleRestart}
               className="w-full bg-yellow-500 text-black font-bold py-4 rounded-xl hover:bg-yellow-400 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
             >
               Play Again / Change Avatar
             </button>
          </div>
        </div>
      )}

      {stickers.length === 0 && !error && isVisionReady && !isPlaying && (
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

      {!isPlaying && (
        <AssetSelector 
            onSelect={(asset) => handleAddSticker(asset)}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
        />
      )}
    </div>
  );
};

export default App;
