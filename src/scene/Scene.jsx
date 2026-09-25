import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import RobotActor from './RobotActor'
import IntroFX from './IntroFX'
import { SCENE_PHASES as P, phaseIndex } from './phases'

// Fixed observer: initialised once, never animated.
const CAMERA = { position: [0, 0.62, 3.35], fov: 28, near: 0.05, far: 60 }
const CAMERA_TARGET = new THREE.Vector3(0, 0.5, 0)
// Neutral tone mapping keeps the whites white (ACES would grey the room down).
const GL = { antialias: true, powerPreference: 'high-performance', toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.12 }
const ROOM_BG = '#f6f6f4'
const WALL_Z = -2.4
// The room is flat-shaded (no lighting maths on the pixels that fill the screen);
// only the robot's shadow is drawn on top of the floor.
const WALL_COLOR = '#f2f2f0'
const FLOOR_COLOR = '#ededeb'

/**
 * Aims the camera once, before any sibling reads it. After this the camera is
 * never touched again — only its projection aspect follows the canvas size.
 */
function FixedCamera() {
  const camera = useThree((s) => s.camera)
  useLayoutEffect(() => {
    camera.position.set(...CAMERA.position)
    camera.lookAt(CAMERA_TARGET)
    camera.updateMatrixWorld()
  }, [camera])
  return null
}

/** Soft vertical gradient used as a faint ambient-occlusion band. */
function useOcclusionTexture() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, 128)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 4, 128)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 4, 128)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.NoColorSpace
    return tex
  }, [])
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

/**
 * Infinite-feeling white robotics room: floor, back wall, barely visible junction.
 * While the intro veil covers the screen the room isn't drawn at all (it renders
 * for its first few frames only, so its shaders are ready before the reveal).
 */
function Room({ hidden }) {
  const ao = useOcclusionTexture()
  const group = useRef()
  const frames = useRef(0)
  useFrame(() => {
    if (frames.current < 3) frames.current++
    group.current.visible = !hidden || frames.current < 3
  })
  return (
    <group ref={group}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[60, 60]} />
        <meshBasicMaterial color={FLOOR_COLOR} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <shadowMaterial color="#1f2421" opacity={0.2} />
      </mesh>
      <mesh position={[0, 12, WALL_Z]}>
        <planeGeometry args={[60, 24]} />
        <meshBasicMaterial color={WALL_COLOR} toneMapped={false} />
      </mesh>
      {/* faint occlusion where floor meets wall (~10% visible boundary) */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.0015, WALL_Z + 0.45]}>
        <planeGeometry args={[60, 0.9]} />
        <meshBasicMaterial color="#5d625f" alphaMap={ao} transparent opacity={0.06} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.35, WALL_Z + 0.002]} rotation-z={Math.PI}>
        <planeGeometry args={[60, 0.7]} />
        <meshBasicMaterial color="#5d625f" alphaMap={ao} transparent opacity={0.045} depthWrite={false} />
      </mesh>
    </group>
  )
}

function Lights({ quality }) {
  return (
    <>
      <ambientLight intensity={0.32} />
      {/* large soft key light */}
      <directionalLight
        position={[2.2, 4.4, 3.2]}
        intensity={1.45}
        castShadow
        shadow-mapSize={[quality.shadowMap, quality.shadowMap]}
        shadow-camera-left={-3.2}
        shadow-camera-right={3.2}
        shadow-camera-top={2.4}
        shadow-camera-bottom={-1.6}
        shadow-camera-near={0.5}
        shadow-camera-far={14}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={quality.tier === 'mobile' ? 3 : 6}
      />
      {/* subtle fill */}
      <directionalLight position={[-3, 2, 2.2]} intensity={0.32} />
      {/* soft frontal wash from the viewer's side: lifts the back wall so the floor/wall seam stays faint */}
      <directionalLight position={[0.4, 1.2, 6]} intensity={0.62} />
      {/* subtle rim from behind */}
      <directionalLight position={[-1, 2.6, -3]} intensity={0.85} />
    </>
  )
}

function StudioEnvironment() {
  // Local light-formers only: no HDR download, neutral white studio reflections.
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.55}>
      <Lightformer form="rect" intensity={2.6} position={[0, 5, 2]} scale={[8, 4, 1]} />
      <Lightformer form="rect" intensity={1.1} position={[-5, 2, 2]} scale={[6, 3, 1]} />
      <Lightformer form="rect" intensity={1.1} position={[5, 2, 1]} scale={[6, 3, 1]} />
      <Lightformer form="rect" intensity={0.8} position={[0, 2, 6]} scale={[8, 4, 1]} />
      <Lightformer form="rect" intensity={0.45} color="#f3f3f1" position={[0, -3, 0]} scale={[10, 10, 1]} />
    </Environment>
  )
}

export default function Scene({ phase, onPhaseDone, onRobotReady, introState, mouse, quality, frameloop }) {
  const showIntroFX = phaseIndex(phase) <= phaseIndex(P.ROOM_REVEAL)
  const heroActive = phase === P.HERO_ACTIVE
  // the veil is fully opaque while loading and during the burst
  const veiled = phase === P.LOADING || phase === P.EXPLOSION

  // Pixel density adapts to the device: it steps down when the frame rate drops.
  const maxDpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, quality.dpr[1])
  const [dpr, setDpr] = useState(maxDpr)

  return (
    <Canvas
      camera={CAMERA}
      gl={GL}
      dpr={dpr}
      shadows="percentage"
      frameloop={frameloop}
      style={{ pointerEvents: 'none' }}
    >
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setDpr((d) => Math.max(1, Math.round((d - 0.25) * 100) / 100))}
        onIncline={() => setDpr((d) => Math.min(maxDpr, Math.round((d + 0.25) * 100) / 100))}
        onFallback={() => setDpr(1)}
      />
      <FixedCamera />
      <color attach="background" args={[ROOM_BG]} />
      <fog attach="fog" args={[ROOM_BG, 6, 24]} />
      <Lights quality={quality} />
      <StudioEnvironment />
      <Room hidden={veiled} />
      <RobotActor phase={phase} onPhaseDone={onPhaseDone} onReady={onRobotReady} mouse={mouse} quality={quality}>
        {/* soft contact shadow / AO under the feet: off behind the veil, baked once the robot has settled */}
        <ContactShadows
          position={[0, 0.002, 0]}
          scale={[9, 6]}
          resolution={quality.contactRes}
          blur={2.4}
          far={1.1}
          opacity={0.42}
          color="#2a2f2c"
          frames={veiled ? 0 : heroActive ? 1 : Infinity}
        />
      </RobotActor>
      {showIntroFX && (
        <IntroFX phase={phase} introState={introState} onPhaseDone={onPhaseDone} count={quality.particles} />
      )}
    </Canvas>
  )
}
