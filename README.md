# Mainframe® — cinematic robotics hero

A full-screen hero for the creative agency Mainframe, built with **React 19 + TypeScript (UI), Vite, Tailwind CSS v4, Three.js, @react-three/fiber and @react-three/drei**.

1. A liquid loader counts to 100%. The screen then turns black and the loader bursts into white stars.
2. A deep red studio fades in.
3. A small service robot walks in from the right. It walks like NVIDIA's "Blue" droid: forward only, quick rhythmic steps, an expressive head. It stops right of centre, framed from the waist up like the character of a portrait video.
4. The robot studies the visitor and then follows the cursor with its head, which stands in for the mouse-scrubbed hero video.
5. Meanwhile the hero types itself in on the left: a blurred intro label, a typewriter line and action pills.

## Run it

Requires Node `^20.19` or `>=22.12` (Vite 8).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build in dist/
npm run typecheck
npm run preview
```

Optional query params (handy for reviews):

| Param | Effect |
| --- | --- |
| `?speed=3` | Fast-forwards the whole sequence (1–8×) |
| `?skipIntro` | Skips the loader and starts with the robot entering the studio |

## Scene phases

The intro is a single, one-way state machine (`src/scene/phases.js`):

```
LOADING → EXPLOSION → ROOM_REVEAL → ROBOT_ENTERING → ROBOT_CENTER → ROBOT_CONFUSED
→ ROBOT_TRACKING (final: the robot follows the cursor)
```

A phase can only advance from itself, so every transition happens exactly once. The hero UI appears with `ROBOT_ENTERING`.

## Structure

| File | Role |
| --- | --- |
| `src/App.tsx` | Phase machine, mouse ref, layout (studio canvas, vignette, navbar, hero, loader) |
| `src/components/LiquidLoader.jsx` | SVG liquid loader 1% → 100%; at 100% the room goes black and the loader turns luminous, then vibrates / contracts |
| `src/scene/Scene.jsx` | Canvas, fixed camera, studio lighting, red studio room, contact shadows |
| `src/scene/IntroFX.jsx` | Full-frame veil (white → black) + white star-particle burst on black (custom shaders) |
| `src/scene/RobotActor.jsx` | Loads the Higgsfield robot; falls back to the procedural one if it can't be downloaded |
| `src/scene/scanRobotModel.js` | Downloads the Higgsfield mesh, skins it to the rig and repaints its texture with a clean palette |
| `src/scene/ScanRobot.jsx` | The Higgsfield robot as one skinned mesh on the articulated rig, with 3D camera-lens eyes and 15 cm antennas |
| `src/scene/Robot.jsx` | Procedural fallback robot (every joint is its own pivot) |
| `src/scene/useRobotRig.js` | Connects any rig to the controller (phases, frame loop, where the robot stands in the frame, resize handling) |
| `src/scene/robotController.js` | Footstep planner, 2-bone leg IK, body dynamics, head/neck control, choreography |
| `src/components/Navbar.tsx` | Mainframe® logo, Labs / Studio / Openings / Shop, Get in touch, mobile hamburger + overlay |
| `src/components/Hero.tsx` | Blurred intro label, typewriter line, action pills, copy-to-clipboard email pill |
| `src/hooks/useTypewriter.ts` | `useTypewriter(text, speed = 38, startDelay = 600)` → `{ displayed, done }` |

Fonts: Helvetica Now Display (Medium for the logo via `--font-heading`, Regular for everything else via `--font-body`), loaded in `index.html`.

### Implementation notes

- **Camera is a fixed observer.** It is aimed once (`FixedCamera`) and never moved; only its projection aspect follows the canvas size.
- **No React state per frame.** Continuous motion runs in `useFrame` on refs; React state changes only on phase transitions. The loader keeps just the integer percentage in state.
- **Physical walking.** The robot only walks forwards (it turns in place or along a curve). Feet are planted in world space and re-placed by a footstep planner (walk, turn in place, final foot correction). Legs are solved with analytic 2-bone IK, ankles keep the soles flat, and the body has weight shift, pelvis twist, heavy foot-strike dip and a mechanical settle.
- **Head tracking.** Normalised mouse (−1…1) → `targetHeadY = mouseX * 15°`, `targetHeadX = −mouseY * 10°` around the look-at-camera pose, clamped and critically damped. Torso, arms, legs and feet stay put.
- **Performance.**
  - Particle count, shadow resolution and pixel density scale with the viewport. Pixel density also steps down automatically when the frame rate drops (`PerformanceMonitor`).
  - The room is flat-shaded, with a shadow-only layer on the floor, so the pixels that fill the screen skip the lighting maths.
  - While the intro veil covers the screen, the room and the contact shadow aren't drawn.
  - The robot's livery is painted in 8 ms slices, so the loader never freezes, and the scan's unused texture is not decoded.
  - Once the robot has settled (`ROBOT_TRACKING`) the contact shadow is baked once.
  - Listeners and Three.js resources are cleaned up on unmount.

## Robot design & Higgsfield

The robot is the **first model generated with Higgsfield** (SAM 3D) from the white / blue bipedal service-robot reference. It's a single textured mesh, so at load time `scanRobotModel.js` skins it to the articulated rig. Every vertex gets smooth weights for the torso, neck, head, thigh, shin and foot bones. The bones sit at landmarks measured on the mesh: hips, a reverse (digitigrade) knee, ankles, the neck base and the head pivot. The shell bends continuously at every joint, so there are no gaps and the cables stay connected.

The scan's own texture is blotchy, so the robot is painted with the reference robot's livery instead. `paintAt` decides the colour of every surface point from its 3D position and normal: an off-white shell, a light grey face with black square lens mounts, blue stripes and leg covers, a dark display window with orange details, bronze joints, and blue feet with an orange sole. The colours are drawn into the mesh's own UV layout, together with a roughness / metalness map so the lenses shine and the joints read as metal. The eyes are real 3D camera lenses like the reference: black square housings, knurled metal barrels, gold-coated lenses under a glossy glass dome, plus a third camera on the head's corner. A 15 cm antenna rises from each side of the head.

The mesh is loaded at runtime from the Higgsfield CDN (`SCAN_URL`, CORS-enabled, immutable). The intro loader holds at 90% until it's ready. If the download fails or takes longer than 30 s, the hand-modelled procedural robot takes over automatically, running the same animation system.
