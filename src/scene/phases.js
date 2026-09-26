export const SCENE_PHASES = {
  LOADING: 'loading',
  EXPLOSION: 'explosion',
  ROOM_REVEAL: 'roomReveal',
  ROBOT_ENTERING: 'robotEntering',
  ROBOT_CENTER: 'robotCenter',
  ROBOT_CONFUSED: 'robotConfused',
  ROBOT_TRACKING: 'robotTracking', // final state: the robot follows the cursor
}

export const PHASE_ORDER = [
  SCENE_PHASES.LOADING,
  SCENE_PHASES.EXPLOSION,
  SCENE_PHASES.ROOM_REVEAL,
  SCENE_PHASES.ROBOT_ENTERING,
  SCENE_PHASES.ROBOT_CENTER,
  SCENE_PHASES.ROBOT_CONFUSED,
  SCENE_PHASES.ROBOT_TRACKING,
]

export function nextPhase(phase) {
  const i = PHASE_ORDER.indexOf(phase)
  return i >= 0 && i < PHASE_ORDER.length - 1 ? PHASE_ORDER[i + 1] : phase
}

export function phaseIndex(phase) {
  return PHASE_ORDER.indexOf(phase)
}

export function isAtLeast(phase, target) {
  return phaseIndex(phase) >= phaseIndex(target)
}

// Durations (seconds) of the purely time-based scene phases.
// Robot phases end when their choreography completes.
export const TIMING = {
  loaderDelay: 0.5,
  loaderProgress: 3.0,
  loaderHold: 0.5,
  loaderCritical: 1.0,
  explosion: 0.85,
  roomReveal: 1.4,
}

// Optional `?speed=2` query param to fast-forward the whole sequence (handy for reviews).
export const TIME_SCALE = (() => {
  if (typeof window === 'undefined') return 1
  const v = parseFloat(new URLSearchParams(window.location.search).get('speed'))
  return Number.isFinite(v) && v > 0 ? Math.min(v, 8) : 1
})()

// Optional `?skipIntro` query param: start directly with the robot entering the room.
export const INITIAL_PHASE = (() => {
  if (typeof window === 'undefined') return SCENE_PHASES.LOADING
  return new URLSearchParams(window.location.search).has('skipIntro') ? SCENE_PHASES.ROBOT_ENTERING : SCENE_PHASES.LOADING
})()
