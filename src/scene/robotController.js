import * as THREE from 'three'
import { SCENE_PHASES as P } from './phases'

/**
 * Procedural animation brain for the service robot.
 *
 * Everything here runs inside `useFrame` and only mutates Three.js objects /
 * plain numbers — it never touches React state. The controller reports the end
 * of each choreographed phase through `onPhaseDone(phase)` exactly once.
 *
 * Coordinates are in "stage" space (the robot's parent group): metres, +Y up,
 * the robot faces +Z (towards the camera) when yaw = 0. Robot-left is +X.
 */

/** Proportions of the procedural robot. A rig can override any of these. */
export const DIM = {
  ankleH: 0.06, // ankle pivot height above the floor
  thigh: 0.125,
  shin: 0.12,
  hipH: 0.27, // hip pivot height when standing
  hipX: 0.075, // hip pivot lateral offset
  footX: 0.08, // neutral foot lateral offset
  footZ: 0, // neutral ankle position along the heading
  kneeDir: 1, // 1: knee bends forward, -1: reverse (digitigrade) knee
  crouch: 0, // extra hip drop while standing
  walkCrouch: 0, // additional hip drop while walking or turning (more reach)
  lowerDepth: 0.1, // hip drop when the robot lowers itself
  maxStep: 0.14,
  speed: 1, // walking speed multiplier
  headWidth: 0.37,
  headTop: 0.9, // highest point incl. antennas (framing)
  // neck chain rest angles (base, mid, head) and how they fold when lowering
  neck: { base: 0.3, mid: -0.6, head: 0.3, foldBase: 0.55, foldMid: -0.8, foldHead: 0.25 },
}

export const MAX_HEAD_YAW = THREE.MathUtils.degToRad(15)
export const MAX_HEAD_PITCH = THREE.MathUtils.degToRad(10)

const UP = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const TAU = Math.PI * 2
const { clamp, lerp } = THREE.MathUtils

const smootherstep = (x) => {
  x = clamp(x, 0, 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}
const easeInOutSine = (x) => -(Math.cos(Math.PI * clamp(x, 0, 1)) - 1) / 2
const easeInOutCubic = (x) => {
  x = clamp(x, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3)

/** Wrapped signed difference b - a in (-PI, PI]. */
function angleDiff(a, b) {
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return d
}

/**
 * Normalised distance travelled for normalised time u, with a smooth
 * (jerk-limited) acceleration over `a` and deceleration over `d`.
 */
function travelProfile(u, a = 0.2, d = 0.3) {
  u = clamp(u, 0, 1)
  const vmax = 1 / (1 - (a + d) / 2)
  const ramp = (x) => x * x * x - 0.5 * x * x * x * x
  if (u < a) return vmax * a * ramp(u / a)
  if (u < 1 - d) return vmax * (0.5 * a + (u - a))
  return 1 - vmax * d * ramp((1 - u) / d)
}

/**
 * Arc-length parametrised path that leaves `p0` heading `h0` and arrives at
 * `p3` heading `h3` (headings are yaw angles; the robot only walks forwards).
 */
function forwardCurve(p0, h0, p3, h3, k = 0.5) {
  const d = p0.distanceTo(p3)
  const p1 = p0.clone().add(new THREE.Vector3(Math.sin(h0), 0, Math.cos(h0)).multiplyScalar(d * k))
  const p2 = p3.clone().sub(new THREE.Vector3(Math.sin(h3), 0, Math.cos(h3)).multiplyScalar(d * k))
  const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3)
  curve.arcLengthDivisions = 240
  return curve
}

/** Critically damped follower (Game Programming Gems 4 "SmoothDamp"). */
class Smooth {
  constructor(v = 0) {
    this.value = v
    this.vel = 0
  }
  to(target, smoothTime, dt) {
    const omega = 2 / Math.max(1e-4, smoothTime)
    const x = omega * dt
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    const change = this.value - target
    const temp = (this.vel + omega * change) * dt
    this.vel = (this.vel - omega * temp) * exp
    this.value = target + (change + temp) * exp
    return this.value
  }
  set(v) {
    this.value = v
    this.vel = 0
  }
}

/** Under-damped spring, sub-stepped for stability. Gives mechanical "settle". */
class Spring {
  constructor(x = 0) {
    this.x = x
    this.v = 0
  }
  step(target, k, zeta, dt) {
    const c = 2 * zeta * Math.sqrt(k)
    let t = dt
    while (t > 1e-6) {
      const h = Math.min(t, 1 / 240)
      const a = -k * (this.x - target) - c * this.v
      this.v += a * h
      this.x += this.v * h
      t -= h
    }
    return this.x
  }
}

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _q3 = new THREE.Quaternion()

export class RobotController {
  /**
   * @param {object} rig   refs to the articulated Object3Ds
   * @param {object} opts  { onPhaseDone(phase) }
   */
  constructor(rig, opts) {
    this.rig = rig
    this.onPhaseDone = opts.onPhaseDone
    this.dim = { ...DIM, ...opts.dims, neck: { ...DIM.neck, ...opts.dims?.neck } }
    this.phase = null
    this.pt = 0
    this.time = 0
    this.plan = {}
    this.reported = new Set()

    this.pos = new THREE.Vector3(-8, 0, -0.4)
    this.prevPos = this.pos.clone()
    this.vel = new THREE.Vector3()
    this.yaw = 1.3
    this.prevYaw = this.yaw
    this.yawRate = 0

    this.feet = [0, 1].map((i) => ({
      side: i === 0 ? 1 : -1,
      pos: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      swing: null,
    }))
    this.lastStep = -1
    this.dsTimer = 0
    this.dsTime = 0.07
    this.swingIndex = -1
    this.stepping = false

    this.bob = new Spring()
    this.lean = new Spring()
    this.lower = new Spring()
    this.shift = new Smooth()
    this.roll = new Smooth()
    this.twist = new Smooth()
    this.leanOffset = new Smooth()
    this.leanOffsetT = 0
    this.lowerTarget = 0
    this.walkLift = 0
    this.crouch = new Smooth()
    this.nod = new Smooth()
    this.idle = 0
    this.arms = [new Spring(), new Spring()]

    this.headYaw = new Smooth()
    this.headPitch = new Smooth(0.06)
    this.headRoll = new Smooth()
    this.headTarget = { yaw: 0, pitch: 0.06, roll: 0 }
    this.headSmooth = 0.4
    this.look = { yaw: 0, pitch: 0 }
    this.lensGlow = new Smooth(0.15)
    this.lensGlowT = 0.15

    this.crouch.set(this.dim.crouch)
    this.placeStanding(this.pos.x, this.pos.z, this.yaw)
  }

  /* ------------------------------------------------------------------ */
  /* Placement / phase set-up                                            */
  /* ------------------------------------------------------------------ */

  neutral(i, pos, yaw, out) {
    out.set(this.feet[i].side * this.dim.footX, 0, this.dim.footZ).applyAxisAngle(UP, yaw)
    out.x += pos.x
    out.z += pos.z
    out.y = this.dim.ankleH
    return out
  }

  placeStanding(x, z, yaw) {
    this.pos.set(x, 0, z)
    this.prevPos.copy(this.pos)
    this.vel.set(0, 0, 0)
    this.yaw = yaw
    this.prevYaw = yaw
    this.yawRate = 0
    this.feet.forEach((f, i) => {
      this.neutral(i, this.pos, yaw, f.pos)
      f.yaw = yaw
      f.pitch = 0
      f.swing = null
    })
    this.lastStep = -1
    this.dsTimer = 0
  }

  /**
   * @param {string} phase
   * @param {{ edgeX(z:number):number }} layout  stage-space right edge of the viewport at depth z
   */
  setPhase(phase, layout) {
    if (phase === this.phase) return
    this.phase = phase
    this.pt = 0
    const plan = (this.plan = {})

    switch (phase) {
      case P.LOADING:
      case P.EXPLOSION:
      case P.ROOM_REVEAL: {
        // Park the robot well outside the frame, facing its walking direction.
        this.placeStanding(-(layout.edgeX(-0.4) + 1.5), -0.4, 1.3)
        this.stepping = false
        break
      }
      case P.ROBOT_ENTERING: {
        // The robot can only walk forwards: it enters from the left heading +X and
        // curves towards the viewer, arriving close enough to be framed waist-up.
        const zStart = 0.8
        const start = new THREE.Vector3(-(layout.edgeX(zStart) + 0.3), 0, zStart)
        const end = new THREE.Vector3(0, 0, this.nearZ(layout))
        plan.curve = forwardCurve(start, Math.PI / 2, end, 0)
        plan.length = plan.curve.getLength()
        plan.T = Math.max(3.5, (plan.length * 1.34) / (0.38 * this.dim.speed))
        this.placeStanding(start.x, start.z, Math.PI / 2)
        this.stepping = true
        this.headYaw.set(0)
        this.headPitch.set(0.1)
        break
      }
      case P.ROBOT_CENTER: {
        plan.p = this.pos.clone()
        plan.yaw = this.yaw
        break
      }
      case P.ROBOT_MOVING_ASIDE: {
        // Forward-only: turn in place towards the free spot, then walk there.
        plan.p0 = this.pos.clone()
        plan.yaw0 = this.yaw
        const zAside = -0.3
        plan.aside = new THREE.Vector3(this.asideX(layout, zAside), 0, zAside)
        plan.yawWalk = Math.atan2(plan.aside.x - plan.p0.x, plan.aside.z - plan.p0.z)
        plan.dYaw = angleDiff(plan.yaw0, plan.yawWalk)
        plan.turnStart = 0.45
        plan.Tt = Math.max(1.2, Math.abs(plan.dYaw) / 1.5)
        plan.walkStart = plan.turnStart + plan.Tt + 0.15
        plan.Tw = Math.max(2, (plan.p0.distanceTo(plan.aside) * 1.34) / (0.38 * this.dim.speed))
        break
      }
      case P.ROBOT_FACING_WALL: {
        plan.yaw0 = this.yaw
        plan.dYaw = angleDiff(this.yaw, Math.PI)
        break
      }
      case P.ROBOT_LOWERING:
      case P.HERO_ACTIVE:
      default:
        break
    }
  }

  /**
   * Stage-space Z where the robot, facing the camera, is framed from the waist
   * up — pulled back if needed so the head still fits the viewport width/height.
   */
  nearZ(layout) {
    const d = this.dim
    const search = (f) => {
      // f(z) is monotonic increasing towards the camera; returns the z where f crosses 0
      let lo = -0.5
      let hi = 2.9
      if (f(hi) < 0) return hi
      if (f(lo) > 0) return lo
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2
        if (f(mid) > 0) hi = mid
        else lo = mid
      }
      return lo
    }
    const waist = search((z) => -layout.project(0, d.hipH, z).y - 0.9) // hip on the bottom edge
    const fitW = search((z) => layout.project(d.headWidth / 2, d.headTop, z).x - 0.86)
    const fitH = search((z) => layout.project(0, d.headTop, z).y - 0.96)
    return Math.min(waist, fitW, fitH)
  }

  /** Stage-space X that leaves ~70% of the robot's silhouette inside the frame. */
  asideX(layout, z) {
    return layout.edgeX(z) - 0.22 * this.dim.headWidth
  }

  finish(phase) {
    if (this.reported.has(phase)) return
    this.reported.add(phase)
    this.onPhaseDone?.(phase)
  }

  /* ------------------------------------------------------------------ */
  /* Frame update                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * @param {number} dt
   * @param {{ camera: THREE.Camera, mouse: {x:number,y:number}, layout: object }} ctx
   */
  update(dt, ctx) {
    this.time += dt
    this.pt += dt
    this.prevPos.copy(this.pos)
    this.prevYaw = this.yaw

    this.runPhase(dt, ctx)

    const inv = 1 / Math.max(dt, 1e-4)
    _v1.copy(this.pos).sub(this.prevPos).multiplyScalar(inv)
    this.vel.lerp(_v1, 1 - Math.exp(-14 * dt))
    const yr = angleDiff(this.prevYaw, this.yaw) * inv
    this.yawRate = lerp(this.yawRate, yr, 1 - Math.exp(-14 * dt))

    this.updateGait(dt)
    this.updateBody(dt)
    this.apply(dt)
  }

  lookAtCamera(camera) {
    this.rig.head.getWorldPosition(_v1)
    _v2.copy(camera.position).sub(_v1).applyAxisAngle(UP, -this.yaw)
    this.look.yaw = Math.atan2(_v2.x, _v2.z)
    this.look.pitch = Math.atan2(-_v2.y, Math.hypot(_v2.x, _v2.z))
    return this.look
  }

  runPhase(dt, ctx) {
    const pl = this.plan
    const ht = this.headTarget
    const t = this.pt
    this.idle = 0
    this.leanOffsetT = 0

    switch (this.phase) {
      case P.ROBOT_ENTERING: {
        const u = clamp(t / pl.T, 0, 1)
        const s = travelProfile(u, 0.14, 0.34)
        pl.curve.getPointAt(s, this.pos)
        pl.curve.getTangentAt(Math.min(s, 0.999), _v3)
        this.yaw = Math.atan2(_v3.x, _v3.z)
        // The head leads into the curve and, halfway, turns to glance at the viewer.
        pl.curve.getTangentAt(Math.min(0.999, s + 0.12), _v3)
        const lead = angleDiff(this.yaw, Math.atan2(_v3.x, _v3.z)) * 0.8
        const look = this.lookAtCamera(ctx.camera)
        const glance = Math.pow(Math.sin(Math.PI * clamp((s - 0.22) / 0.36, 0, 1)), 2) * 0.85
        ht.yaw = lerp(lead, clamp(look.yaw, -1.1, 1.1), glance)
        ht.pitch = lerp(0.14, look.pitch, glance)
        ht.roll = 0.06 * glance
        this.headSmooth = 0.4
        this.lensGlowT = 0.15 + 0.3 * glance
        if (t >= pl.T + 0.35 && this.gaitIdle()) this.finish(P.ROBOT_ENTERING)
        break
      }

      case P.ROBOT_CENTER: {
        this.pos.copy(pl.p)
        this.yaw = pl.yaw
        this.idle = smootherstep((t - 0.8) / 1.5)
        if (t > 1.0) {
          // The robot notices the viewer: only the head and neck move.
          const look = this.lookAtCamera(ctx.camera)
          ht.yaw = look.yaw
          ht.pitch = look.pitch
          ht.roll = 0
          this.headSmooth = 0.45
          this.lensGlowT = 0.55
        }
        if (t > 3.1 && this.gaitIdle()) this.finish(P.ROBOT_CENTER)
        break
      }

      case P.ROBOT_CONFUSED: {
        this.idle = 1
        const look = this.lookAtCamera(ctx.camera)
        let dy = 0
        let dr = 0
        let dp = 0
        if (t > 0.15 && t < 1.0) {
          dy = 0.22
          dr = -0.12
          dp = 0.04
        } else if (t >= 1.0 && t < 1.95) {
          dy = -0.22
          dr = 0.12
          dp = 0.04
        }
        ht.yaw = look.yaw + dy
        ht.pitch = look.pitch + dp
        ht.roll = dr
        this.headSmooth = 0.3
        if (t > 2.85) this.finish(P.ROBOT_CONFUSED)
        break
      }

      case P.ROBOT_TRACKING: {
        this.idle = 1
        const look = this.lookAtCamera(ctx.camera)
        const mx = clamp(ctx.mouse.x, -1, 1)
        const my = clamp(ctx.mouse.y, -1, 1)
        const targetHeadY = mx * MAX_HEAD_YAW
        const targetHeadX = -my * MAX_HEAD_PITCH
        const tm = this.time
        ht.yaw = look.yaw + clamp(targetHeadY, -MAX_HEAD_YAW, MAX_HEAD_YAW) + 0.008 * Math.sin(tm * 0.37)
        ht.pitch = look.pitch + clamp(targetHeadX, -MAX_HEAD_PITCH, MAX_HEAD_PITCH) + 0.005 * Math.sin(tm * 0.53 + 2)
        ht.roll = -mx * 0.035
        this.headSmooth = 0.38
        this.lensGlowT = 0.6
        break
      }

      case P.ROBOT_MOVING_ASIDE: {
        // A) notices the movement — small flinch, attention on the viewer
        this.leanOffsetT = t < 0.5 ? -0.04 : 0
        // B) turns in place towards the free spot (the head lingers on the viewer)
        const ut = easeInOutSine((t - pl.turnStart) / pl.Tt)
        this.yaw = pl.yaw0 + pl.dYaw * ut
        // C) walks forwards to make room, then settles
        const uw = clamp((t - pl.walkStart) / pl.Tw, 0, 1)
        this.pos.lerpVectors(pl.p0, pl.aside, travelProfile(uw, 0.22, 0.34))
        const look = this.lookAtCamera(ctx.camera)
        const away = smootherstep((t - pl.turnStart - pl.Tt * 0.45) / 0.8)
        ht.yaw = lerp(clamp(look.yaw, -1.1, 1.1), 0, away)
        ht.pitch = lerp(look.pitch, 0.12, away)
        ht.roll = 0
        this.headSmooth = 0.32
        this.lensGlowT = 0.45 - 0.3 * away
        if (t >= pl.walkStart + pl.Tw + 0.3 && this.gaitIdle()) this.finish(P.ROBOT_MOVING_ASIDE)
        break
      }

      case P.ROBOT_FACING_WALL: {
        // Body turns first, the head lingers on the viewer, then follows.
        const u = clamp(t / 2.3, 0, 1)
        this.yaw = pl.yaw0 + pl.dYaw * easeInOutSine(u)
        if (t < 1.25) {
          const look = this.lookAtCamera(ctx.camera)
          ht.yaw = clamp(look.yaw, -1.15, 1.15)
          ht.pitch = look.pitch
          this.headSmooth = 0.35
        } else {
          ht.yaw = 0
          ht.pitch = 0.05
          this.headSmooth = 0.55
          this.lensGlowT = 0.15
        }
        ht.roll = 0
        if (t >= 2.9 && this.gaitIdle()) this.finish(P.ROBOT_FACING_WALL)
        break
      }

      case P.ROBOT_LOWERING: {
        // slight knee bend -> lower torso -> compress legs -> settle
        this.lowerTarget = t < 0.35 ? 0.16 * easeOutCubic(t / 0.35) : 0.16 + 0.84 * easeInOutCubic((t - 0.35) / 1.4)
        this.leanOffsetT = 0.075 * this.lowerTarget
        ht.yaw = 0
        ht.pitch = 0.05 + 0.16 * this.lowerTarget
        ht.roll = 0
        this.headSmooth = 0.6
        this.lensGlowT = 0.05
        if (t >= 2.7) this.finish(P.ROBOT_LOWERING)
        break
      }

      case P.HERO_ACTIVE: {
        this.lowerTarget = 1
        this.leanOffsetT = 0.075
        ht.yaw = 0
        ht.pitch = 0.21
        this.lensGlowT = 0.05
        break
      }

      default:
        break
    }
  }

  /* ------------------------------------------------------------------ */
  /* Footstep planner                                                     */
  /* ------------------------------------------------------------------ */

  footError(i) {
    const f = this.feet[i]
    this.neutral(i, this.pos, this.yaw, _v3)
    return Math.hypot(_v3.x - f.pos.x, _v3.z - f.pos.z) + Math.abs(angleDiff(f.yaw, this.yaw)) * 0.12
  }

  gaitIdle() {
    if (this.feet[0].swing || this.feet[1].swing) return false
    if (Math.hypot(this.vel.x, this.vel.z) > 0.02) return false
    return this.footError(0) < 0.02 && this.footError(1) < 0.02
  }

  updateGait(dt) {
    let swinging = -1
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i]
      const s = f.swing
      if (!s) continue
      s.t = Math.min(1, s.t + dt / s.dur)
      const e = smootherstep(s.t)
      f.pos.lerpVectors(s.from, s.to, e)
      // quick lift, crisp placement
      f.pos.y = this.dim.ankleH + s.lift * Math.pow(Math.sin(Math.PI * Math.min(1, s.t * 1.06)), 0.7)
      f.yaw = s.fromYaw + angleDiff(s.fromYaw, s.toYaw) * e
      // toe lifts mid-swing, lands flat (ankle compensation)
      f.pitch = -0.2 * s.pitchAmt * Math.sin(Math.PI * Math.min(1, s.t * 1.08))
      if (s.t >= 1) {
        f.pos.copy(s.to)
        f.yaw = s.toYaw
        f.pitch = 0
        f.swing = null
        this.lastStep = i
        this.dsTimer = this.dsTime
        // heavy foot strike: a small dip in the body that springs back
        this.bob.v -= 0.11 * s.impact
      } else {
        swinging = i
      }
    }
    this.swingIndex = swinging
    if (swinging < 0 && this.stepping) {
      this.dsTimer -= dt
      if (this.dsTimer <= 0) this.tryStep()
    }
  }

  tryStep() {
    const speed = Math.hypot(this.vel.x, this.vel.z)
    const turning = Math.abs(this.yawRate) > 0.2
    const moving = speed > 0.035 || turning
    const errs = [this.footError(0), this.footError(1)]

    let pick = -1
    if (moving) {
      let first = this.lastStep >= 0 ? 1 - this.lastStep : -1
      if (first < 0) {
        // start with the foot on the side we are moving towards
        const c = Math.cos(this.yaw)
        const s = Math.sin(this.yaw)
        const lat = this.vel.x * c - this.vel.z * s
        first = Math.abs(lat) > 0.02 ? (lat > 0 ? 0 : 1) : errs[0] >= errs[1] ? 0 : 1
      }
      if (errs[first] > 0.012) pick = first
      else if (errs[1 - first] > 0.03) pick = 1 - first
    } else {
      const m = errs[0] >= errs[1] ? 0 : 1
      if (errs[m] > 0.014) pick = m
    }
    if (pick < 0) return

    const f = this.feet[pick]
    const dur = moving ? 0.34 : 0.32
    const ahead = dur + (moving ? 0.5 * (dur + this.dsTime) : 0)
    const predPos = _v1.set(this.pos.x + this.vel.x * ahead, 0, this.pos.z + this.vel.z * ahead)
    const predYaw = this.yaw + this.yawRate * ahead * 0.85
    const target = this.neutral(pick, predPos, predYaw, new THREE.Vector3())

    // limit reach relative to the current neutral stance
    const n0 = this.neutral(pick, this.pos, this.yaw, _v2)
    const off = _v3.copy(target).sub(n0)
    off.y = 0
    if (off.length() > this.dim.maxStep) off.setLength(this.dim.maxStep)
    target.copy(n0).add(off)

    // never let the feet cross (important when side-stepping)
    const local = off.copy(target).sub(predPos).applyAxisAngle(UP, -predYaw)
    if (f.side > 0) local.x = Math.max(local.x, 0.045)
    else local.x = Math.min(local.x, -0.045)
    local.applyAxisAngle(UP, predYaw)
    target.set(predPos.x + local.x, this.dim.ankleH, predPos.z + local.z)

    const dist = Math.hypot(target.x - f.pos.x, target.z - f.pos.z)
    if (dist < 0.006 && Math.abs(angleDiff(f.yaw, predYaw)) < 0.05) {
      this.dsTimer = 0.05
      return
    }
    f.swing = {
      from: f.pos.clone(),
      to: target,
      fromYaw: f.yaw,
      toYaw: predYaw,
      t: 0,
      dur,
      lift: clamp(0.016 + dist * 0.3, 0.016, 0.05),
      pitchAmt: clamp(dist / 0.12, 0.2, 1),
      impact: clamp(0.35 + dist / 0.15, 0.35, 1),
    }
  }

  /* ------------------------------------------------------------------ */
  /* Body dynamics                                                        */
  /* ------------------------------------------------------------------ */

  updateBody(dt) {
    const sw = this.swingIndex
    let stanceSide = 0
    let swingAmt = 0
    if (sw >= 0) {
      swingAmt = Math.sin(Math.PI * this.feet[sw].swing.t)
      stanceSide = -this.feet[sw].side
    }
    const c = Math.cos(this.yaw)
    const s = Math.sin(this.yaw)
    const fwd = this.vel.x * s + this.vel.z * c
    const lat = this.vel.x * c - this.vel.z * s
    const speed = Math.hypot(this.vel.x, this.vel.z)
    const idle = this.idle
    const t = this.time

    // weight shifts over the stance foot; pelvis twists with the swing leg
    const shiftT = stanceSide * 0.013 * swingAmt + idle * 0.0045 * Math.sin(t * 0.42)
    const rollT = -stanceSide * 0.034 * swingAmt - lat * 0.05 + idle * 0.003 * Math.sin(t * 0.61 + 1)
    const twistT = sw >= 0 ? -this.feet[sw].side * 0.04 * swingAmt * clamp(fwd / 0.3, -1, 1) : 0
    this.leanOffset.to(this.leanOffsetT, 0.25, dt)
    const leanT =
      clamp(fwd * 0.16, -0.05, 0.08) +
      this.leanOffset.value +
      idle * (0.004 * Math.sin(t * 1.1) + 0.002 * Math.sin(t * 2.3 + 0.5))

    this.shift.to(shiftT, 0.12, dt)
    this.roll.to(rollT, 0.12, dt)
    this.twist.to(twistT, 0.1, dt)
    this.lean.step(leanT, 60, 0.55, dt)
    this.bob.step(0, 170, 0.5, dt)
    this.lower.step(this.lowerTarget, 38, 0.72, dt)
    this.walkLift = swingAmt * clamp(speed / 0.35, 0, 1) * 0.006
    const busy = Math.max(clamp(speed / 0.18, 0, 1), clamp(Math.abs(this.yawRate) / 0.8, 0, 1))
    this.crouch.to(this.dim.crouch + this.dim.walkCrouch * busy, 0.3, dt)
    // the head nods a little with every step
    this.nod.to(swingAmt * 0.045 * clamp(speed / 0.2, 0, 1), 0.08, dt)

    for (let i = 0; i < 2; i++) {
      const side = this.feet[i].side
      this.arms[i].step(-this.lean.x * 0.9 + side * this.roll.value * 0.3, 55, 0.35, dt)
    }
    this.lensGlow.to(this.lensGlowT, 0.5, dt)
  }

  /* ------------------------------------------------------------------ */
  /* Apply to the rig                                                     */
  /* ------------------------------------------------------------------ */

  apply(dt) {
    const r = this.rig
    const low = this.lower.x

    r.root.position.set(this.pos.x, 0, this.pos.z)
    r.root.rotation.y = this.yaw
    const dim = this.dim
    r.body.position.set(this.shift.value, dim.hipH - this.crouch.value + this.bob.x + this.walkLift - dim.lowerDepth * low, 0)
    r.body.rotation.set(this.lean.x, this.twist.value, this.roll.value)

    // head & neck: targets are relative to the root heading; cancel body sway so the head stays stable
    const ht = this.headTarget
    this.headYaw.to(clamp(ht.yaw, -1.25, 1.25), this.headSmooth, dt)
    this.headPitch.to(clamp(ht.pitch, -0.45, 0.5), this.headSmooth, dt)
    this.headRoll.to(clamp(ht.roll, -0.3, 0.3), this.headSmooth, dt)
    const hy = this.headYaw.value - this.twist.value
    const hp = this.headPitch.value - this.lean.x + this.nod.value
    const hr = this.headRoll.value - this.roll.value
    const fold = clamp(low, 0, 1.2)

    r.neckBase.quaternion
      .setFromAxisAngle(Y_AXIS, hy * 0.3)
      .multiply(_q1.setFromAxisAngle(X_AXIS, dim.neck.base + dim.neck.foldBase * fold + hp * 0.25))
    r.neckMid.rotation.set(dim.neck.mid + dim.neck.foldMid * fold, 0, 0)
    r.head.quaternion
      .setFromAxisAngle(X_AXIS, dim.neck.head + dim.neck.foldHead * fold)
      .multiply(_q1.setFromAxisAngle(Y_AXIS, hy * 0.7))
      .multiply(_q2.setFromAxisAngle(X_AXIS, hp * 0.75))
      .multiply(_q3.setFromAxisAngle(Z_AXIS, hr))

    r.arms.forEach((arm, i) => {
      if (arm) arm.rotation.x = this.arms[i].x
    })
    if (r.lensMaterial) r.lensMaterial.emissiveIntensity = this.lensGlow.value

    // legs: world-space footholds -> 2-bone IK
    r.stage.updateWorldMatrix(true, true)
    _m.copy(r.body.matrixWorld).invert().multiply(r.stage.matrixWorld)
    this.solveLeg(0, _m)
    this.solveLeg(1, _m)
  }

  solveLeg(i, toBody) {
    const r = this.rig
    const f = this.feet[i]
    const hip = r.hips[i]
    const knee = r.knees[i]
    const ankle = r.ankles[i]
    const L1 = this.dim.thigh
    const L2 = this.dim.shin
    const kneeDir = this.dim.kneeDir

    const v = _v1.copy(f.pos).applyMatrix4(toBody).sub(hip.position)
    const roll = Math.atan2(v.x, -v.y)
    const down = Math.hypot(v.x, v.y)
    const fwd = v.z
    const D = clamp(Math.hypot(down, fwd), Math.abs(L1 - L2) + 0.01, L1 + L2 - 1e-4)
    const alpha = Math.atan2(fwd, down)
    const beta = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1))
    const gamma = Math.acos(clamp((L2 * L2 + D * D - L1 * L1) / (2 * L2 * D), -1, 1))
    // kneeDir 1: knee ahead of the hip-ankle line; -1: behind it (reverse knee)
    const thigh = alpha + kneeDir * beta

    hip.rotation.set(-thigh, 0, roll)
    knee.rotation.set(kneeDir * (beta + gamma), 0, 0)

    // ankle keeps the sole flat on the floor (plus toe pitch while swinging)
    knee.getWorldQuaternion(_q1).invert()
    _q2.setFromAxisAngle(Y_AXIS, f.yaw).multiply(_q3.setFromAxisAngle(X_AXIS, f.pitch))
    ankle.quaternion.copy(_q1.multiply(_q2))
  }
}
