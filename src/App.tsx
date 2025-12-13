import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
// Note: we keep the mediapipe imports but will disable AI on mobile for performance
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- detect mobile ---
const isMobileUA = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// --- base visual config (desktop defaults) ---
const BASE_CONFIG = {
  colors: {
    emerald: '#004225',
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#D32F2F',
    green: '#2E7D32',
    white: '#FFFFFF',
    warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'],
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
    candyColors: ['#FF0000', '#FFFFFF']
  },
  counts: {
    foliage: 15000,
    ornaments: 300,
    elements: 200,
    lights: 400
  },
  tree: { height: 22, radius: 9 },
  photos: {
    body: ['/photos/top.jpg', ...Array.from({ length: 25 }, (_, i) => `/photos/${i + 1}.jpg`)]
  }
};

// --- Create runtime config depending on device ---
const useRuntimeConfig = () => {
  const isMobile = isMobileUA();
  return useMemo(() => {
    const cfg = JSON.parse(JSON.stringify(BASE_CONFIG));
    if (isMobile) {
      // aggressive downscale for mobile devices
      cfg.counts.foliage = 4000; // from 15k -> 4k
      cfg.counts.ornaments = 100; // from 300 -> 100
      cfg.counts.elements = 60; // from 200 -> 60
      cfg.counts.lights = 120; // from 400 -> 120
    }
    return { cfg, isMobile };
  }, []);
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(BASE_CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = (treeCfg: any) => {
  const h = treeCfg.height; const rBase = treeCfg.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state, treeCfg, count }: { state: 'CHAOS' | 'FORMED', treeCfg: any, count: number }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      const [tx, ty, tz] = getTreePosition(treeCfg);
      targetPositions[i*3] = tx; targetPositions[i*3+1] = ty; targetPositions[i*3+2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, [count, treeCfg]);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Photo Ornaments (simplified for mobile) ---
const PhotoOrnaments = ({ state, textures, count, isMobile }: any) => {
  const groupRef = useRef<THREE.Group>(null);
  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.0, 1.25), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(0.8, 0.8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*50, (Math.random()-0.5)*50, (Math.random()-0.5)*50);
      const h = 22; const y = (Math.random() * h) - (h / 2);
      const rBase = 9; const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2; const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const isBig = Math.random() < 0.16; const baseScale = isBig ? 1.6 : 0.7 + Math.random() * 0.4;
      const borderColor = BASE_CONFIG.colors.borders[Math.floor(Math.random() * BASE_CONFIG.colors.borders.length)];
      const rotationSpeed = { x: (Math.random()-0.5)*0.8, y: (Math.random()-0.5)*0.8, z: (Math.random()-0.5)*0.8 };
      return { chaosPos, targetPos, scale: baseScale, textureIndex: i % textures.length, borderColor, currentPos: chaosPos.clone(), rotationSpeed };
    });
  }, [count, textures]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED'; const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 : 0.5));
      group.position.copy(objData.currentPos);
      if (isFormed) {
        group.rotation.y += (Math.sin(time * 0.3 + i) * 0.002);
      } else {
        group.rotation.x += delta * objData.rotationSpeed.x;
        group.rotation.y += delta * objData.rotationSpeed.y;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} scale={[obj.scale, obj.scale, obj.scale]} rotation={[0,0,0]}>
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial map={textures[obj.textureIndex]} roughness={0.6} metalness={0} emissiveIntensity={isMobile ? 0 : 0.6} side={THREE.FrontSide} />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.12, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Simplified Christmas Elements & Lights (reduced complexity) ---
const ChristmasElements = ({ state, count }: any) => {
  const groupRef = useRef<THREE.Group>(null);
  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.6, 0.6, 0.6), []);

  const data = useMemo(() => new Array(count).fill(0).map(() => {
    const chaosPos = new THREE.Vector3((Math.random()-0.5)*40, (Math.random()-0.5)*40, (Math.random()-0.5)*40);
    const h = 22; const y = (Math.random() * h) - (h / 2); const rBase = 9; const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95; const theta = Math.random() * Math.PI * 2;
    const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
    const rotationSpeed = { x: (Math.random()-0.5)*1.2, y: (Math.random()-0.5)*1.2, z: (Math.random()-0.5)*1.2 };
    return { chaosPos, targetPos, color: BASE_CONFIG.colors.giftColors[Math.floor(Math.random() * BASE_CONFIG.colors.giftColors.length)], scale: 0.7 + Math.random() * 0.3, currentPos: chaosPos.clone(), rotationSpeed };
  }), [count]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i]; const target = isFormed ? objData.targetPos : objData.chaosPos; objData.currentPos.lerp(target, delta * 1.2); (child as THREE.Mesh).position.copy(objData.currentPos);
      child.rotation.x += delta * objData.rotationSpeed.x; child.rotation.y += delta * objData.rotationSpeed.y;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={boxGeometry}><meshStandardMaterial color={obj.color} roughness={0.4} metalness={0.2} /></mesh>)}
    </group>
  );
};

const FairyLights = ({ state, count }: any) => {
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.3, 6, 6), []);
  const data = useMemo(() => new Array(count).fill(0).map(() => ({ chaosPos: new THREE.Vector3((Math.random()-0.5)*40, (Math.random()-0.5)*40, (Math.random()-0.5)*40), targetPos: new THREE.Vector3(0,0,0), color: BASE_CONFIG.colors.lights[Math.floor(Math.random()*BASE_CONFIG.colors.lights.length)], speed: 2 + Math.random()*2, currentPos: new THREE.Vector3() })), [count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return; const time = stateObj.clock.elapsedTime; const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i]; const target = isFormed ? objData.targetPos : objData.chaosPos; objData.currentPos.lerp(target, delta * 1.8); (child as THREE.Mesh).position.copy(objData.currentPos);
      if ((child as any).material) (child as any).material.emissiveIntensity = isFormed ? 2 + Math.abs(Math.sin(time * objData.speed)) : 0;
    });
  });

  return (
    <group ref={groupRef}>{data.map((obj, i) => <mesh key={i} scale={[0.12,0.12,0.12]} geometry={geometry}><meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} /></mesh>)}</group>
  );
};

// --- TopStar simplified ---
const TopStar = ({ state }: any) => {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => { if (groupRef.current) { groupRef.current.rotation.y += delta * 0.4; const targetScale = state === 'FORMED' ? 1 : 0; groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3); } });
  return (
    <group ref={groupRef} position={[0, 12, 0]}>
      <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.1}><mesh><coneGeometry args={[1,1.6,5]} /><meshStandardMaterial color={BASE_CONFIG.colors.gold} emissive={BASE_CONFIG.colors.gold} emissiveIntensity={0.8} roughness={0.1} metalness={1} /></mesh></Float>
    </group>
  );
};

// --- Experience ---
const Experience = ({ sceneState, rotationSpeed, runtime }: any) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => { if (controlsRef.current) { controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed); controlsRef.current.update(); } });
  const { cfg, isMobile } = runtime;
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={!isMobile} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={[ '#000300' ]} />
      <Stars radius={100} depth={50} count={isMobile ? 800 : 5000} factor={isMobile ? 2 : 4} saturation={0} fade speed={1} />
      <Environment preset={isMobile ? undefined : 'night'} background={false} />

      <ambientLight intensity={isMobile ? 0.3 : 0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={isMobile ? 30 : 100} color={BASE_CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={isMobile ? 20 : 50} color={BASE_CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={isMobile ? 10 : 30} color="#ffffff" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} treeCfg={cfg.tree} count={cfg.counts.foliage} />
        <Suspense fallback={null}>
          <PhotoOrnaments state={sceneState} textures={useTexture(cfg.photos.body)} count={cfg.counts.ornaments} isMobile={isMobile} />
          <ChristmasElements state={sceneState} count={cfg.counts.elements} />
          <FairyLights state={sceneState} count={cfg.counts.lights} />
          <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={isMobile ? 120 : 600} scale={isMobile ? 20 : 50} size={isMobile ? 4 : 8} speed={0.4} opacity={0.4} color={BASE_CONFIG.colors.silver} />
      </group>

      {!isMobile && (
        <EffectComposer>
          <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
          <Vignette eskil={false} offset={0.1} darkness={1.2} />
        </EffectComposer>
      )}
    </>
  );
};

// --- Gesture Controller (disabled on mobile by default for perf) ---
const GestureController = ({ onGesture, onMove, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer | null = null;
    let requestRef: number;
    let cancelled = false;
    const isMobile = isMobileUA();

    if (isMobile) {
      onStatus('AI DISABLED ON MOBILE');
      return () => {};
    }

    const setup = async () => {
      onStatus('DOWNLOADING AI...');
      try {
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm');
        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 1
        });
        onStatus('REQUESTING CAMERA...');
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
          if (videoRef.current) {
            videoRef.current.srcObject = stream; videoRef.current.play(); onStatus('AI READY: SHOW HAND'); predictWebcam();
          }
        } else {
          onStatus('ERROR: CAMERA PERMISSION DENIED');
        }
      } catch (err: any) {
        onStatus(`ERROR: ${err?.message || 'MODEL FAILED'}`);
      }
    };

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current && !cancelled) {
        if (videoRef.current.videoWidth > 0) {
          const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
          const ctx = canvasRef.current.getContext('2d');
          if (ctx && debugMode) {
            ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height);
            canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
            if (results.landmarks) for (const landmarks of results.landmarks) {
              const drawingUtils = new DrawingUtils(ctx);
              drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: '#FFD700', lineWidth: 2 });
              drawingUtils.drawLandmarks(landmarks, { color: '#FF0000', lineWidth: 1 });
            }
          } else if (ctx) ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height);

          if (results.gestures.length > 0) {
            const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
            if (score > 0.4) {
              if (name === 'Open_Palm') onGesture('CHAOS'); if (name === 'Closed_Fist') onGesture('FORMED');
              if (debugMode) onStatus(`DETECTED: ${name}`);
            }
            if (results.landmarks.length > 0) {
              const speed = (0.5 - results.landmarks[0][0].x) * 0.15; onMove(Math.abs(speed) > 0.01 ? speed : 0);
            }
          } else { onMove(0); if (debugMode) onStatus('AI READY: NO HAND'); }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };

    setup();
    return () => { cancelled = true; if (requestRef) cancelAnimationFrame(requestRef); };
  }, [onGesture, onMove, onStatus, debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- App Entry (optimized mobile fallback) ---
export default function GrandTreeApp() {
  const runtime = useRuntimeConfig();
  const { cfg, isMobile } = runtime;

  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState('INITIALIZING...');
  const [debugMode, setDebugMode] = useState(false);

  // small safety: if mobile, show lightweight placeholder until Canvas mounts
  if (isMobile) {
    return (
      <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
          <Canvas dpr={0.7} shadows={false} gl={{ powerPreference: 'low-power', antialias: false }}>
            <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} runtime={runtime} />
          </Canvas>
        </div>

        <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} debugMode={debugMode} />

        {/* UI - simplified for mobile */}
        <div style={{ position: 'absolute', bottom: '22px', left: '20px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
          <p style={{ fontSize: '12px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>{cfg.counts.ornaments} POLAROIDS</p>
        </div>

        <div style={{ position: 'absolute', bottom: '20px', right: '20px', zIndex: 10, display: 'flex', gap: '8px' }}>
          <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '10px 12px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', cursor: 'pointer' }}>
            {debugMode ? 'HIDE' : 'DEBUG'}
          </button>
          <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '10px 18px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,215,0,0.4)', color: '#FFD700', cursor: 'pointer' }}>
            {sceneState === 'CHAOS' ? 'Assemble' : 'Disperse'}
          </button>
        </div>

        <div style={{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.6)', fontSize: '12px', zIndex: 10, background: 'rgba(0,0,0,0.4)', padding: '4px 8px', borderRadius: '4px' }}>{aiStatus}</div>
      </div>
    );
  }

  // desktop / non-mobile UI (full features)
  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} shadows gl={{ toneMapping: THREE.ReinhardToneMapping }}>
          <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} runtime={runtime} />
        </Canvas>
      </div>

      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} debugMode={debugMode} />

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Memories</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>{cfg.counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span></p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Foliage</p>
          <p style={{ fontSize: '24px', color: '#004225', fontWeight: 'bold', margin: 0 }}>{(cfg.counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>EMERALD NEEDLES</span></p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', cursor: 'pointer' }}>{debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}</button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>{sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}</button>
      </div>

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>{aiStatus}</div>
    </div>
  );
}
