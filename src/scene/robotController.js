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

export const DIM = {
  ankleH: 0.06, // ankle pivot height above the floor
  thigh: 0.125,
  shin: 0.12,
  hipH: 0.27, // hip pivot height when standing
  hipX: 0.075, // hip pivot lateral offset
  footX: 0.08, // neutral foot lateral offset
  headWidth: 0.37,
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
    this.dsTime = 0.1
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

    this.placeStanding(this.pos.x, this.pos.z, this.yaw)
  }

  /* ------------------------------------------------------------------ */
  /* Placement / phase set-up                                            */
  /* ------------------------------------------------------------------ */

  neutral(i, pos, yaw, out) {
    out.set(this.feet[i].side * DIM.footX, 0, 0).applyAxisAngle(UP, yaw)
    out.x += pos.x
    out.z += pos.z
    out.y = DIM.ankleH
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
        const zStart = -0.42
        const start = new THREE.Vector3(-(layout.edgeX(zStart) + 0.12), 0, zStart)
        const end = new THREE.Vector3(0, 0, 0)
        const dist = start.distanceTo(end)
        plan.start = start
        plan.end = end
        plan.yawWalk = Math.atan2(end.x - start.x, end.z - start.z)
        plan.yawEnd = 0.22
        // Peak walking speed ~0.38 m/s: slow, heavy and deliberate.
        plan.T = Math.max(2.8, (dist * 1.34) / 0.38)
        this.placeStanding(start.x, start.z, plan.yawWalk)
        this.stepping = true
        this.headYaw.set(0)
        this.headPitch.set(0.08)
        break
      }
      case P.ROBOT_CENTER: {
        plan.p = this.pos.clone()
        plan.yaw = this.yaw
        break
      }
      case P.ROBOT_MOVING_ASIDE: {
        plan.p0 = this.pos.clone()
        plan.yaw0 = this.yaw
        plan.back = this.pos.clone().add(new THREE.Vector3(0, 0, -0.12))
        const zAside = -0.3
        plan.aside = new THREE.Vector3(this.asideX(layout, zAside), 0, zAside)
        plan.yawAside = 0.45
        plan.Tl = Math.max(1.6, (plan.back.distanceTo(plan.aside) * 1.43) / 0.32)
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

  /** Stage-space X that leaves ~70% of the robot's silhouette inside the frame. */
  asideX(layout, z) {
    return layout.edgeX(z) - 0.22 * DIM.headWidth
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
        const s = travelProfile(u, 0.16, 0.36)
        this.pos.lerpVectors(pl.start, pl.end, s)
        const turn = smootherstep((s - 0.52) / 0.48)
        this.yaw = pl.yawWalk + angleDiff(pl.yawWalk, pl.yawEnd) * turn
        // Look ahead with a slow scan; keep looking along the path while the body turns.
        const lag = angleDiff(this.yaw, pl.yawWalk)
        ht.yaw = lag * 0.55 + 0.1 * Math.sin(this.time * 0.6) * (1 - turn)
        ht.pitch = 0.1
        ht.roll = 0
        this.headSmooth = 0.55
        this.lensGlowT = 0.15
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
        this.leanOffsetT = t < 0.55 ? -0.045 : t < 1.5 ? -0.02 : 0
        // B) one small step backwards (feet follow through the gait planner)
        const ub = easeInOutSine((t - 0.3) / 0.95)
        this.pos.lerpVectors(pl.p0, pl.back, ub)
        // C) politely moves aside to make room
        const ul = clamp((t - 1.5) / pl.Tl, 0, 1)
        if (ul > 0) this.pos.lerpVectors(pl.back, pl.aside, travelProfile(ul, 0.26, 0.36))
        this.yaw = pl.yaw0 + angleDiff(pl.yaw0, pl.yawAside) * smootherstep(ul * 1.25)
        const look = this.lookAtCamera(ctx.camera)
        const travel = angleDiff(this.yaw, Math.PI / 2)
        const glance = 0.35 * Math.sin(Math.PI * ul)
        ht.yaw = lerp(look.yaw, travel, glance)
        ht.pitch = look.pitch
        ht.roll = 0
        this.headSmooth = 0.3
        this.lensGlowT = 0.45
        if (t >= 1.5 + pl.Tl + 0.3 && this.gaitIdle()) this.finish(P.ROBOT_MOVING_ASIDE)
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
      f.pos.y = DIM.ankleH + s.lift * Math.pow(Math.sin(Math.PI * s.t), 0.85)
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
    const dur = moving ? 0.5 : 0.42
    const ahead = dur + (moving ? 0.5 * (dur + this.dsTime) : 0)
    const predPos = _v1.set(this.pos.x + this.vel.x * ahead, 0, this.pos.z + this.vel.z * ahead)
    const predYaw = this.yaw + this.yawRate * ahead * 0.85
    const target = this.neutral(pick, predPos, predYaw, new THREE.Vector3())

    // limit reach relative to the current neutral stance
    const n0 = this.neutral(pick, this.pos, this.yaw, _v2)
    const off = _v3.copy(target).sub(n0)
    off.y = 0
    if (off.length() > 0.14) off.setLength(0.14)
    target.copy(n0).add(off)

    // never let the feet cross (important when side-stepping)
    const local = off.copy(target).sub(predPos).applyAxisAngle(UP, -predYaw)
    if (f.side > 0) local.x = Math.max(local.x, 0.045)
    else local.x = Math.min(local.x, -0.045)
    local.applyAxisAngle(UP, predYaw)
    target.set(predPos.x + local.x, DIM.ankleH, predPos.z + local.z)

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
      lift: clamp(0.012 + dist * 0.24, 0.012, 0.045),
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
    const shiftT = stanceSide * 0.011 * swingAmt + idle * 0.0045 * Math.sin(t * 0.42)
    const rollT = -stanceSide * 0.026 * swingAmt - lat * 0.05 + idle * 0.003 * Math.sin(t * 0.61 + 1)
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
    this.walkLift = swingAmt * clamp(speed / 0.35, 0, 1) * 0.005

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
    r.body.position.set(this.shift.value, DIM.hipH + this.bob.x + this.walkLift - 0.1 * low, 0)
    r.body.rotation.set(this.lean.x, this.twist.value, this.roll.value)

    // head & neck: targets are relative to the root heading; cancel body sway so the head stays stable
    const ht = this.headTarget
    this.headYaw.to(clamp(ht.yaw, -1.25, 1.25), this.headSmooth, dt)
    this.headPitch.to(clamp(ht.pitch, -0.45, 0.5), this.headSmooth, dt)
    this.headRoll.to(clamp(ht.roll, -0.3, 0.3), this.headSmooth, dt)
    const hy = this.headYaw.value - this.twist.value
    const hp = this.headPitch.value - this.lean.x
    const hr = this.headRoll.value - this.roll.value
    const fold = clamp(low, 0, 1.2)

    r.neckBase.quaternion
      .setFromAxisAngle(Y_AXIS, hy * 0.3)
      .multiply(_q1.setFromAxisAngle(X_AXIS, 0.3 + 0.55 * fold + hp * 0.25))
    r.neckMid.rotation.set(-0.6 - 0.8 * fold, 0, 0)
    r.head.quaternion
      .setFromAxisAngle(X_AXIS, 0.3 + 0.25 * fold)
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
    const L1 = DIM.thigh
    const L2 = DIM.shin

    const v = _v1.copy(f.pos).applyMatrix4(toBody).sub(hip.position)
    const roll = Math.atan2(v.x, -v.y)
    const down = Math.hypot(v.x, v.y)
    const fwd = v.z
    const D = clamp(Math.hypot(down, fwd), Math.abs(L1 - L2) + 0.01, L1 + L2 - 1e-4)
    const alpha = Math.atan2(fwd, down)
    const beta = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1))
    const gamma = Math.acos(clamp((L2 * L2 + D * D - L1 * L1) / (2 * L2 * D), -1, 1))
    const thigh = alpha + beta // knee points forward

    hip.rotation.set(-thigh, 0, roll)
    knee.rotation.set(beta + gamma, 0, 0)

    // ankle keeps the sole flat on the floor (plus toe pitch while swinging)
    knee.getWorldQuaternion(_q1).invert()
    _q2.setFromAxisAngle(Y_AXIS, f.yaw).multiply(_q3.setFromAxisAngle(X_AXIS, f.pitch))
    ankle.quaternion.copy(_q1.multiply(_q2))
  }
}
