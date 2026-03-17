import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { Play, Mic, Info, Loader2, Camera as CameraIcon, RefreshCcw } from 'lucide-react';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isStarted, setIsStarted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [volume, setVolume] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const startSystem = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Your browser does not support camera access or you are in an insecure context.");
      }

      console.log("Requesting media permissions...");
      
      // Try to get video first as it's essential
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 640 }, 
            height: { ideal: 480 },
            facingMode: "user"
          } 
        });
      } catch (videoErr) {
        console.warn("Failed to get video with ideal constraints, trying basic video...", videoErr);
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      // Try to add audio separately to avoid failing the whole system if mic is missing
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStream.getAudioTracks().forEach(track => stream.addTrack(track));
        
        console.log("Audio permissions granted, initializing audio...");
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        const audioCtx = new AudioContextClass();
        
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -40;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);
        
        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      } catch (audioErr) {
        console.warn("Microphone not found or access denied. Continuing without audio reaction.", audioErr);
      }

      if (videoRef.current) {
        console.log("Setting video srcObject...");
        videoRef.current.srcObject = stream;
        await new Promise((resolve) => {
          videoRef.current!.onloadedmetadata = () => resolve(true);
        });
        await videoRef.current.play();
        console.log("Video playing");
      }

      setIsStarted(true);
      setIsLoading(false);
    } catch (err: any) {
      console.error("Detailed System Error:", err);
      let msg = `Error: ${err.message || "Unknown error"}`;
      if (err.name === 'NotAllowedError') msg = "Permission denied. Please check your browser's site settings for camera.";
      else if (err.name === 'NotFoundError' || err.message?.includes('device not found')) msg = "Camera not found. Please ensure your camera is connected.";
      else if (err.name === 'NotReadableError') msg = "Hardware error: Camera is likely in use by another tab or app.";
      
      setError(msg);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    startSystem();
  }, []);

  useEffect(() => {
    if (!isStarted || !containerRef.current || !videoRef.current) return;

    let isMounted = true;

    // --- Three.js Setup ---
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);

    camera.position.z = 6;

    // --- Create Texture Atlas for Digits ---
    const atlasSize = 512;
    const canvas = document.createElement('canvas');
    canvas.width = atlasSize;
    canvas.height = atlasSize;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, atlasSize, atlasSize);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 160px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cols = 4;
    const cellSize = atlasSize / cols;
    for (let i = 0; i < 10; i++) {
      const x = (i % cols) * cellSize + cellSize / 2;
      const y = Math.floor(i / cols) * cellSize + cellSize / 2;
      ctx.fillText(i.toString(), x, y);
    }
    const texture = new THREE.CanvasTexture(canvas);

    // --- Particles Setup ---
    const faceParticleCount = 468;
    const handParticleCount = 42; // 21 * 2
    const bgParticleCount = 1200;
    const totalCount = faceParticleCount + handParticleCount + bgParticleCount;
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(totalCount * 3);
    const digitIndices = new Float32Array(totalCount);
    const opacities = new Float32Array(totalCount);
    const sizes = new Float32Array(totalCount);
    const colors = new Float32Array(totalCount * 3);
    const types = new Float32Array(totalCount);

    const colorWhite = new THREE.Color(0xffffff);
    const colorGreen = new THREE.Color(0x39ff14);
    const colorYellow = new THREE.Color(0xffff00);
    const colorPurple = new THREE.Color(0xbf00ff);

    for (let i = 0; i < totalCount; i++) {
      const rand = Math.random();
      let selectedColor: THREE.Color;
      if (rand < 0.3) selectedColor = colorWhite;
      else if (rand < 0.55) selectedColor = colorYellow;
      else if (rand < 0.8) selectedColor = colorGreen;
      else selectedColor = colorPurple;

      colors[i * 3] = selectedColor.r;
      colors[i * 3 + 1] = selectedColor.g;
      colors[i * 3 + 2] = selectedColor.b;

      if (i < faceParticleCount) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = -10;
        types[i] = 0;
        sizes[i] = (Math.random() * 0.08 + 0.08) * 1.5;
        opacities[i] = 0;
      } else if (i < faceParticleCount + handParticleCount) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = -10;
        types[i] = 0;
        sizes[i] = (Math.random() * 0.1 + 0.1) * 1.5;
        opacities[i] = 0;
      } else {
        positions[i * 3] = (Math.random() - 0.5) * 25;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 15 - 5;
        types[i] = 1;
        sizes[i] = Math.random() * 0.4 + 0.1;
        opacities[i] = 0.4;
      }
      digitIndices[i] = Math.floor(Math.random() * 10);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('digitIndex', new THREE.BufferAttribute(digitIndices, 1));
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('type', new THREE.BufferAttribute(types, 1));

    const shaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uTime: { value: 0 },
        uVolume: { value: 0 },
      },
      vertexShader: `
        attribute float digitIndex;
        attribute float opacity;
        attribute float size;
        attribute float type;
        attribute vec3 color;
        varying float vDigitIndex;
        varying float vOpacity;
        varying float vType;
        varying vec3 vColor;
        uniform float uTime;
        uniform float uVolume;
        
        void main() {
          vDigitIndex = digitIndex;
          vOpacity = opacity;
          vType = type;
          vColor = color;
          
          vec3 pos = position;
          
          if (type > 0.5) {
            pos.x += sin(uTime * 0.5 + position.y * 0.5) * 0.2;
            pos.y += cos(uTime * 0.3 + position.x * 0.5) * 0.2;
            pos.z += uVolume * 2.0;
          } else {
            pos.z += uVolume * 1.5;
          }

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          float reactiveSize = size * (1.0 + uVolume * 2.0);
          gl_PointSize = reactiveSize * 80.0 * (5.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        varying float vDigitIndex;
        varying float vOpacity;
        varying float vType;
        varying vec3 vColor;
        
        void main() {
          float col = mod(vDigitIndex, 4.0);
          float row = floor(vDigitIndex / 4.0);
          vec2 uv = gl_PointCoord;
          uv.x = (uv.x + col) / 4.0;
          uv.y = (uv.y + row) / 4.0;
          uv.y = 1.0 - uv.y;
          
          vec4 texColor = texture2D(uTexture, uv);
          float alpha = texColor.a * vOpacity;
          
          if (vType > 0.5) alpha *= 0.6;
          
          gl_FragColor = vec4(vColor * texColor.rgb, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(geometry, shaderMaterial);
    scene.add(particles);

    // --- Hand Lines Setup ---
    const handConnections = [
      [0, 1], [1, 2], [2, 3], [3, 4], // thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // index
      [5, 9], [9, 10], [10, 11], [11, 12], // middle
      [9, 13], [13, 14], [14, 15], [15, 16], // ring
      [13, 17], [17, 18], [18, 19], [19, 20], // pinky
      [0, 17], [5, 9], [9, 13], [13, 17] // palm
    ];
    
    const handLinesGeometries = [new THREE.BufferGeometry(), new THREE.BufferGeometry()];
    const handLinesMaterials = new THREE.LineBasicMaterial({ 
      color: 0x39ff14, 
      transparent: true, 
      opacity: 0.3,
      blending: THREE.AdditiveBlending 
    });
    const handLines = handLinesGeometries.map(geo => {
      const linePositions = new Float32Array(handConnections.length * 2 * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
      const line = new THREE.LineSegments(geo, handLinesMaterials);
      line.visible = false;
      scene.add(line);
      return line;
    });

    // --- Face Mesh Setup ---
    let faceMesh: FaceMesh;
    try {
      faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      console.error("Failed to initialize FaceMesh:", err);
      setError("Failed to initialize face tracking model.");
      return;
    }

    faceMesh.onResults((results) => {
      if (!isMounted) return;
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      const opacAttr = geometry.attributes.opacity as THREE.BufferAttribute;

      if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        setFaceDetected(true);
        const landmarks = results.multiFaceLandmarks[0];

        const count = Math.min(faceParticleCount, landmarks.length);
        for (let i = 0; i < count; i++) {
          const landmark = landmarks[i];
          posAttr.setXYZ(
            i,
            (0.5 - landmark.x) * 12, 
            (0.5 - landmark.y) * 12,
            -landmark.z * 5
          );
          opacAttr.setX(i, 1.0);
        }
      } else {
        setFaceDetected(false);
        for (let i = 0; i < faceParticleCount; i++) {
          opacAttr.setX(i, Math.max(0, opacAttr.getX(i) - 0.05));
        }
      }
      
      posAttr.needsUpdate = true;
      opacAttr.needsUpdate = true;
    });

    // --- Hands Setup ---
    let hands: Hands;
    try {
      hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      console.error("Failed to initialize Hands:", err);
      // We don't necessarily want to stop the whole app if hands fail
    }

    if (hands) {
      hands.onResults((results) => {
        if (!isMounted) return;
        const posAttr = geometry.attributes.position as THREE.BufferAttribute;
        const opacAttr = geometry.attributes.opacity as THREE.BufferAttribute;

        // Fade out hand particles and hide lines
        for (let i = faceParticleCount; i < faceParticleCount + handParticleCount; i++) {
          opacAttr.setX(i, Math.max(0, opacAttr.getX(i) - 0.1));
        }
        handLines.forEach(line => line.visible = false);

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          results.multiHandLandmarks.forEach((landmarks, handIndex) => {
            if (handIndex >= 2) return;
            const offset = faceParticleCount + handIndex * 21;
            const count = Math.min(21, landmarks.length);
            for (let i = 0; i < count; i++) {
              const landmark = landmarks[i];
              posAttr.setXYZ(
                offset + i,
                (0.5 - landmark.x) * 12,
                (0.5 - landmark.y) * 12,
                -landmark.z * 5
              );
              opacAttr.setX(offset + i, 1.0);
            }

            // Update hand lines
            const lineGeo = handLinesGeometries[handIndex];
            const linePosAttr = lineGeo.attributes.position as THREE.BufferAttribute;
            handConnections.forEach((conn, i) => {
              const p1 = landmarks[conn[0]];
              const p2 = landmarks[conn[1]];
              if (p1 && p2) {
                linePosAttr.setXYZ(i * 2, (0.5 - p1.x) * 12, (0.5 - p1.y) * 12, -p1.z * 5);
                linePosAttr.setXYZ(i * 2 + 1, (0.5 - p2.x) * 12, (0.5 - p2.y) * 12, -p2.z * 5);
              }
            });
            linePosAttr.needsUpdate = true;
            handLines[handIndex].visible = true;
          });
        }

        posAttr.needsUpdate = true;
        opacAttr.needsUpdate = true;
      });
    }

    // Use MediaPipe Camera utility for better frame capturing
    const cameraUtils = new Camera(videoRef.current!, {
      onFrame: async () => {
        if (!isMounted) return;
        try {
          if (faceMesh) {
            await faceMesh.send({ image: videoRef.current! });
          }
          if (hands) {
            await hands.send({ image: videoRef.current! });
          }
        } catch (err) {
          console.error("MediaPipe send error:", err);
        }
      },
      width: 640,
      height: 480
    });
    cameraUtils.start();

    // --- Animation Loop ---
    let renderFrameId: number;
    const animate = (time: number) => {
      if (!isMounted) return;
      const t = time * 0.001;
      shaderMaterial.uniforms.uTime.value = t;
      
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          sum += dataArrayRef.current[i];
        }
        const rawAvg = sum / dataArrayRef.current.length / 255;
        // Increase sensitivity: use square root to boost low values and apply a multiplier
        const sensitiveAvg = Math.min(1.0, Math.pow(rawAvg, 0.4) * 2.5);
        setVolume(sensitiveAvg);
        shaderMaterial.uniforms.uVolume.value = sensitiveAvg;
      }

      // Update background particles
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      for (let i = faceParticleCount + handParticleCount; i < totalCount; i++) {
        let z = posAttr.getZ(i);
        z += 0.01;
        if (z > 5) z = -10;
        posAttr.setZ(i, z);
      }
      posAttr.needsUpdate = true;
      
      particles.rotation.y = Math.sin(t * 0.2) * 0.05;
      
      renderer.render(scene, camera);
      renderFrameId = requestAnimationFrame(animate);
    };
    animate(0);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      isMounted = false;
      window.removeEventListener('resize', handleResize);
      cameraUtils.stop();
      cancelAnimationFrame(renderFrameId);
      faceMesh.close();
      hands.close();
      handLinesGeometries.forEach(geo => geo.dispose());
      handLinesMaterials.dispose();
      renderer.dispose();
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [isStarted]);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-sans">
      {/* Background Atmosphere */}
      <div className="absolute inset-0 bg-radial-gradient from-zinc-900 to-black opacity-50" />
      
      {/* Three.js Container */}
      <div ref={containerRef} className="absolute inset-0 z-10" />

      {/* Video Preview for Debugging */}
      <video 
        ref={videoRef} 
        className={`absolute bottom-4 left-4 w-32 h-24 rounded-lg border border-white/20 z-50 object-cover mirror ${isStarted ? 'block' : 'hidden'}`}
        playsInline 
        muted 
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* UI Overlay */}
      {isStarted && (
        <>
          <div className="absolute top-8 left-8 z-20 flex flex-col gap-2">
            <div className="flex items-center gap-3 text-zinc-500 text-[10px] font-mono uppercase tracking-widest">
              <div className={`w-2 h-2 rounded-full ${faceDetected ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-red-500'}`} />
              {faceDetected ? 'Neural Link Established' : 'Scanning for Host...'}
              <div className="w-[1px] h-3 bg-zinc-800" />
              <Mic size={10} className={volume > 0.1 ? 'text-emerald-500' : ''} />
              <span>Audio Feed: {Math.round(volume * 100)}%</span>
              <div className="w-[1px] h-3 bg-zinc-800" />
              <button onClick={() => window.location.reload()} className="flex items-center gap-1 hover:text-white transition-colors">
                <RefreshCcw size={10} />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Bottom Info */}
          <div className="absolute bottom-8 right-8 z-20 flex items-center gap-4">
            <div className="text-right">
              <p className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] mb-1">Ratio Distribution</p>
              <div className="flex gap-1 h-1 w-48 bg-zinc-900 rounded-full overflow-hidden">
                <div className="h-full bg-white" style={{ width: '30%' }} />
                <div className="h-full bg-[#ffff00]" style={{ width: '25%' }} />
                <div className="h-full bg-[#39ff14]" style={{ width: '25%' }} />
                <div className="h-full bg-[#bf00ff]" style={{ width: '20%' }} />
              </div>
            </div>
            <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center text-white/20">
              <Info size={16} />
            </div>
          </div>
        </>
      )}

      {/* Loading State */}
      {isLoading && !isStarted && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black">
          <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-4" />
          <p className="text-zinc-400 font-mono text-sm animate-pulse tracking-widest">SYNCING DEVICES...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-black/90 p-8 text-center">
          <CameraIcon className="w-16 h-16 text-red-500 mb-6" />
          <h2 className="text-2xl font-bold text-white mb-2">System Error</h2>
          <p className="text-zinc-400 max-w-md">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-8 px-6 py-2 bg-white text-black font-bold rounded-full hover:bg-emerald-500 transition-colors">
            Reboot System
          </button>
        </div>
      )}

      {/* Scanline Effect */}
      <div className="absolute inset-0 pointer-events-none z-50 opacity-[0.05] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
    </div>
  );
}
