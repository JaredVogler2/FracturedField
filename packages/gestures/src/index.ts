export * from './types.js';
export { handFeatures, type HandFeatures } from './features.js';
export { ShapeClassifier } from './shapes.js';
export { OneEuro } from './math.js';
export {
  Calibrator,
  defaultCalibration,
  type Calibration,
  type CalibrationPhase,
  type CalibrationProgress,
  type CalibrationSample,
} from './calibration.js';
export { GestureEngine, DEFAULT_GESTURE_CONFIG, type GestureConfig } from './engine.js';
export {
  AUTHORITY_THRESHOLDS,
  ContinuousMapper,
  DEFAULT_CONTINUOUS_CALIBRATION,
  DEFAULT_CONTINUOUS_CONFIG,
  OPEN_HAND,
  knuckleRoll,
  type ContinuousCalibration,
  type ContinuousConfig,
  type HandChannel,
} from './continuous.js';
