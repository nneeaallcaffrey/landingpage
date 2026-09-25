# Mainframe® — cinematic robotics hero

An interactive, cinematic landing hero built with **React 19, Tailwind CSS v4, Motion (`motion/react`), Three.js, @react-three/fiber and @react-three/drei**.

A visitor enters an empty white robotics test room. A small service robot notices them, walks in from the left, studies them curiously, follows the cursor with its head, and — on the first scroll — politely steps back, moves aside, turns to the wall and crouches, revealing the actual website.

## Run it

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
| `src/scene/Robot.jsx` | Procedural, fully articulated robot (every joint is its own pivot) |
| `src/scene/robotController.js` | Footstep planner, 2-bone leg IK, body dynamics, head/neck control, choreography |
| `src/components/Navbar.jsx` | Navbar + mobile menu |
| `src/components/Hero.jsx` | Typewriter headline, description, multi-select service pills |
| `src/hooks/useTypewriter.js` | `useTypewriter(text, speed = 38, startDelay = 600)` |

### Implementation notes

- **Camera is a fixed observer.** It is aimed once (`FixedCamera`) and never moved; only its projection aspect follows the canvas size.
- **No React state per frame.** Continuous motion runs in `useFrame` on refs; React state changes only on phase transitions. The loader keeps just the integer percentage in state.
- **Physical walking.** Feet are planted in world space and re-placed by a footstep planner (walk, sidestep, backward step, turn in place, final foot correction). Legs are solved with analytic 2-bone IK, ankles keep the soles flat, and the body has weight shift, pelvis twist, heavy foot-strike dip and a mechanical settle.
- **Head tracking.** Normalised mouse (−1…1) → `targetHeadY = mouseX * 15°`, `targetHeadX = −mouseY * 10°` around the look-at-camera pose, clamped and critically damped. Torso, arms, legs and feet stay put.
- **Performance.** Particle count, shadow resolution, geometry detail and DPR scale with the viewport. After `HERO_ACTIVE` the contact shadow is baked once and the canvas switches to on-demand rendering. Listeners and Three.js resources are cleaned up on unmount.

## Robot design & Higgsfield

The robot follows the supplied white / blue bipedal service-robot references:
- a wide, flat sensor head with two gold-rimmed optical sensors and a 15 cm antenna rising from the "ear" housing on each side
- a dark two-joint neck
- a boxy white torso with blue lower panels, side emblems and cable loops
- short legs with large dark knee actuators and big wedge feet

The references were brought in with **Higgsfield**, which also generated 3D meshes from them with SAM 3D. Those meshes come back as one fused, unrigged surface, so the head and legs can't move independently. They were used as a design reference. The site builds its own articulated robot from separate parts so every joint can animate.
