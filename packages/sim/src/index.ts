export { initPhysics, physicsVersion } from './rapier.js';
export { Rng, seedFromString, type RngState } from './rng.js';
export { StateHasher } from './hash.js';
export { detectGoalCrossing, scoringPlaneX } from './goal.js';
export { arenaStaticShapes, type StaticShape, type StaticRole } from './arena.js';
export { PhysicsWorld, GROUP, type EntityRecord, type ImpactReport } from './physics.js';
export {
  GameWorld,
  createWorld,
  type TickInput,
  type StepResult,
  type SeatResult,
  type WorldOptions,
  type WorldCheckpoint,
} from './game.js';
export { runPhysicsHarness, HARNESS_TICKS, type HarnessResult } from './harness.js';
export * as simMath from './math.js';
export {
  makeBenchArena,
  RegionLoad,
  BenchInputs,
  bodyPositions,
  ElementStress,
  ELEMENT_STRESS_LOADOUTS,
  saturatedAbilities,
} from './bench-scenario.js';
export { SnapshotBot, type BotDifficulty } from './bot.js';
