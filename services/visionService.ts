
import { FilesetResolver, FaceLandmarker, FaceLandmarkerResult, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

let faceLandmarker: FaceLandmarker | null = null;
let handLandmarker: HandLandmarker | null = null;

export async function initializeVision() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  
  // Initialize Face Landmarker
  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
      delegate: "GPU"
    },
    outputFaceBlendshapes: false,
    runningMode: "VIDEO",
    numFaces: 1
  });

  // Initialize Hand Landmarker
  handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1
  });
  
  console.log("Vision models loaded");
}

export function detectFace(video: HTMLVideoElement, startTimeMs: number): FaceLandmarkerResult | null {
  if (!faceLandmarker) return null;
  return faceLandmarker.detectForVideo(video, startTimeMs);
}

export function detectHands(video: HTMLVideoElement, startTimeMs: number): HandLandmarkerResult | null {
  if (!handLandmarker) return null;
  return handLandmarker.detectForVideo(video, startTimeMs);
}

// Helper to get anchor coordinates from landmarks
// Returns normalized coordinates (0-1) and scale multiplier relative to face width
export function getAnchorData(result: FaceLandmarkerResult, anchorType: string) {
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
  
  const landmarks = result.faceLandmarks[0];
  
  // Key Landmarks:
  // 1: Nose Tip
  // 33: Left Eye Inner, 263: Right Eye Inner (for rotation/width)
  // 10: Top of Head (Hairline)
  // 152: Chin
  // 234: Left Cheek, 454: Right Cheek (Face Width)
  
  const noseTip = landmarks[1];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const topHead = landmarks[10];
  const chin = landmarks[152];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];

  // Calculate Face Width (for scaling)
  const faceWidth = Math.hypot(rightCheek.x - leftCheek.x, rightCheek.y - leftCheek.y);
  
  // Calculate Rotation (Roll) based on eyes
  const angleRad = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const angleDeg = angleRad * (180 / Math.PI);

  let x = 0;
  let y = 0;
  let scale = faceWidth;

  switch (anchorType) {
    case 'eyes':
      // Center between eyes
      x = (leftEye.x + rightEye.x) / 2;
      y = (leftEye.y + rightEye.y) / 2;
      break;
    
    case 'head':
      // Top of head (hairline)
      x = topHead.x;
      y = topHead.y;
      break;

    case 'face':
      // Center of face (Nose tip is a good approximation for masks)
      x = noseTip.x;
      y = noseTip.y;
      break;

    case 'body':
      // Estimate neck/body position relative to chin
      // Extend down from chin
      x = chin.x;
      y = chin.y; 
      // Note: Body is usually wider than face, so we might boost scale in component
      break;

    default:
      return null;
  }

  return { x, y, scale, rotation: angleDeg };
}
