# Mainframe® — cinematic robotics hero

An interactive, cinematic landing hero built with **React 19, Tailwind CSS v4, Motion (`motion/react`), Three.js, @react-three/fiber and @react-three/drei**.

A visitor enters an empty white robotics test room. A small service robot (walking like NVIDIA's "Blue" droid — forward only, quick rhythmic steps, expressive head) walks in from the left, comes right up to the camera until it's framed from the waist up, studies the visitor curiously and follows the cursor with its head. On the first scroll it turns around, walks off to the side, faces the wall and sits down, revealing the actual website.

## Run it

Requires Node `^20.19` or `>=22.12` (Vite 8).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run preview
```

Optional query params (handy for reviews):

| Param | Effect |
| --- | --- |
| `?speed=3` | Fast-forwards the whole sequence (1–8×) |
| `?skipIntro` | Skips the loader and starts with the robot entering the room |

## Scene phases

The intro is a single, one-way state machine (`src/scene/phases.js`):

```
LOADING → EXPLOSION → ROOM_REVEAL → ROBOT_ENTERING → ROBOT_CENTER → ROBOT_CONFUSED
→ ROBOT_TRACKING → (first downward scroll / swipe / ↓ key) → ROBOT_MOVING_ASIDE
→ ROBOT_FACING_WALL → ROBOT_LOWERING → HERO_ACTIVE
```

A phase can only advance from itself, so every transition happens exactly once.

## Structure

| File | Role |
| --- | --- |
| `src/App.jsx` | Phase machine, mouse ref, scroll/touch/key trigger, scroll lock, layout |
| `src/components/LiquidLoader.jsx` | SVG liquid loader 1% → 100%, then vibrate / contract / brighten |
| `src/scene/Scene.jsx` | Canvas, fixed camera, studio lighting, white room, contact shadows |
| `src/scene/IntroFX.jsx` | Full-frame veil + white star-particle burst (custom shaders) |
| `src/scene/RobotActor.jsx` | Loads the Higgsfield robot; falls back to the procedural one if it can't be downloaded |
| `src/scene/scanRobotModel.js` | Downloads the Higgsfield mesh, skins it to the rig and repaints its texture with a clean palette |
| `src/scene/ScanRobot.jsx` | The Higgsfield robot as one skinned mesh on the articulated rig (15 cm antennas) |
| `src/scene/Robot.jsx` | Procedural fallback robot (every joint is its own pivot) |
| `src/scene/useRobotRig.js` | Connects any rig to the controller (phases, frame loop, resize handling) |
| `src/scene/robotController.js` | Footstep planner, 2-bone leg IK, body dynamics, head/neck control, choreography |
| `src/components/Navbar.jsx` | Navbar + mobile menu |
| `src/components/Hero.jsx` | Typewriter headline, description, multi-select service pills |
| `src/hooks/useTypewriter.js` | `useTypewriter(text, speed = 38, startDelay = 600)` |

### Implementation notes

- **Camera is a fixed observer.** It is aimed once (`FixedCamera`) and never moved; only its projection aspect follows the canvas size.
- **No React state per frame.** Continuous motion runs in `useFrame` on refs; React state changes only on phase transitions. The loader keeps just the integer percentage in state.
- **Physical walking.** The robot only walks forwards (it turns in place or along a curve). Feet are planted in world space and re-placed by a footstep planner (walk, turn in place, final foot correction). Legs are solved with analytic 2-bone IK, ankles keep the soles flat, and the body has weight shift, pelvis twist, heavy foot-strike dip and a mechanical settle.
- **Head tracking.** Normalised mouse (−1…1) → `targetHeadY = mouseX * 15°`, `targetHeadX = −mouseY * 10°` around the look-at-camera pose, clamped and critically damped. Torso, arms, legs and feet stay put.
- **Performance.** Particle count, shadow resolution, geometry detail and DPR scale with the viewport. After `HERO_ACTIVE` the contact shadow is baked once and the canvas switches to on-demand rendering. Listeners and Three.js resources are cleaned up on unmount.

## Robot design & Higgsfield

The robot is the **first model generated with Higgsfield** (SAM 3D) from the white / blue bipedal service-robot reference. It's a single textured mesh, so at load time `scanRobotModel.js` skins it to the articulated rig. Every vertex gets smooth weights for the torso, neck, head, thigh, shin and foot bones. The bones sit at landmarks measured on the mesh: hips, a reverse (digitigrade) knee, ankles, the neck base and the head pivot. The shell bends continuously at every joint, so there are no gaps and the cables stay connected.

The scanned texture is repainted with a clean white / blue / graphite palette; a majority filter removes the scan's small dark specks. A 15 cm antenna rises from each side of the head.

The mesh is loaded at runtime from the Higgsfield CDN (`SCAN_URL`, CORS-enabled, immutable). The intro loader holds at 90% until it's ready. If the download fails or takes longer than 30 s, the hand-modelled procedural robot takes over automatically, running the same animation system.
