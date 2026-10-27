/**
 * The D04 reaction fixtures R1–R10 (canonical JSON under packages/sim/fixtures/reactions),
 * validated on load. Imported by the regression tests and the Physics Lab only — never by the
 * room worker or the game bundle.
 */
import r01 from '../fixtures/reactions/r01-ice-ramp.json' with { type: 'json' };
import r02 from '../fixtures/reactions/r02-melt.json' with { type: 'json' };
import r03 from '../fixtures/reactions/r03-steam.json' with { type: 'json' };
import r04 from '../fixtures/reactions/r04-lodestone.json' with { type: 'json' };
import r05 from '../fixtures/reactions/r05-overload.json' with { type: 'json' };
import r06 from '../fixtures/reactions/r06-fire-wind.json' with { type: 'json' };
import r07 from '../fixtures/reactions/r07-gravity.json' with { type: 'json' };
import r08 from '../fixtures/reactions/r08-fracture.json' with { type: 'json' };
import r09 from '../fixtures/reactions/r09-winds.json' with { type: 'json' };
import r10 from '../fixtures/reactions/r10-thermal-shock.json' with { type: 'json' };
import { parseScenarioFixture, type ScenarioFixture } from './scenario.js';

export const REACTION_FIXTURES: readonly ScenarioFixture[] = [
  r01,
  r02,
  r03,
  r04,
  r05,
  r06,
  r07,
  r08,
  r09,
  r10,
].map((raw) => parseScenarioFixture(raw));
