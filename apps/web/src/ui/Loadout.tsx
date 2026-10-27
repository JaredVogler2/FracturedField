import { DEFAULT_ABILITIES, type AbilityId, type AdvancedAbilityId } from '@ff/game-data';
import { PICKABLE } from '../game/settings';

/** Player-facing names and one-line rules for every ability (HUD chips, picker, help). */
export const ABILITY_INFO: Record<AbilityId, { readonly name: string; readonly blurb: string }> = {
  pulse: { name: 'Pulse', blurb: 'Push bodies away from your force point' },
  lift: { name: 'Lift', blurb: 'Hold to raise the nearest body; pulse it for a lob' },
  sweep: { name: 'Sweep', blurb: 'A crosswind that bends anything passing through' },
  guard: { name: 'Guard', blurb: 'Raise a stone barrier for a few seconds' },
  infuse: { name: 'Infuse', blurb: 'Soak with water or set a flame (the wind carries it)' },
  freeze: { name: 'Freeze', blurb: 'Water becomes an ice ramp; hot stone cracks when chilled' },
  charge: { name: 'Charge', blurb: 'Discharge through water, metal and wet stone' },
  gravity: { name: 'Gravity', blurb: 'A short gravity well that bends every flight path' },
  magnetize: { name: 'Magnet', blurb: 'Hold to drag the steel lodestones toward you' },
  draw: { name: 'Draw', blurb: 'Not available yet' },
  focus: { name: 'Focus', blurb: 'Not available yet' },
};

/**
 * Pick two advanced moves (the base kit is always available). Choosing a third replaces the
 * older pick, so the selection is always valid.
 */
export function LoadoutPicker({
  value,
  onChange,
  disabled = false,
  testIdPrefix = 'loadout',
}: {
  value: readonly [AdvancedAbilityId, AdvancedAbilityId];
  onChange: (next: [AdvancedAbilityId, AdvancedAbilityId]) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  const toggle = (id: AdvancedAbilityId) => {
    if (value.includes(id)) return;
    onChange([value[1], id]);
  };
  return (
    <div className="loadout" role="group" aria-label="Advanced moves (pick two)">
      <div className="me-eyebrow">ADVANCED MOVES · PICK TWO</div>
      <div className="loadout-grid">
        {PICKABLE.map((id) => {
          const on = value.includes(id);
          return (
            <button
              key={id}
              type="button"
              className={`loadout-chip${on ? ' on' : ''}`}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(id)}
              data-testid={`${testIdPrefix}-${id}`}
              title={ABILITY_INFO[id].blurb}
            >
              <b>{ABILITY_INFO[id].name}</b>
              <small>
                {DEFAULT_ABILITIES[id].cost}
                {DEFAULT_ABILITIES[id].kind === 'hold' ? '+' : ''} energy
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A peer-reported loadout (lobby data) as typed picks, or undefined when it is not a valid pair. */
export function parseLoadout(
  picks: readonly string[] | null | undefined,
): [AdvancedAbilityId, AdvancedAbilityId] | undefined {
  const pickable = PICKABLE as readonly string[];
  const [a, b] = picks ?? [];
  return a && b && a !== b && pickable.includes(a) && pickable.includes(b)
    ? [a as AdvancedAbilityId, b as AdvancedAbilityId]
    : undefined;
}

export function loadoutLabel(picks: readonly string[] | null | undefined): string {
  if (!picks || picks.length === 0) return 'default moves';
  return picks.map((p) => ABILITY_INFO[p as AbilityId]?.name ?? p).join(' · ');
}
