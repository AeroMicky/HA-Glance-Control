export interface ServiceCall {
  domain: string
  service: string
  entityId: string
  serviceData?: Record<string, unknown>
}

export interface SubItem {
  label: string
  serviceCall: ServiceCall
}

const COLORS: Array<{ label: string; hs: [number, number] }> = [
  { label: 'Warm white', hs: [30, 30] },
  { label: 'Cool white', hs: [210, 10] },
  { label: 'Red',        hs: [0, 100] },
  { label: 'Orange',     hs: [30, 100] },
  { label: 'Yellow',     hs: [60, 100] },
  { label: 'Green',      hs: [120, 100] },
  { label: 'Blue',       hs: [240, 100] },
  { label: 'Purple',     hs: [280, 100] },
  { label: 'Pink',       hs: [320, 80] },
]

function supportsColor(modes: unknown): boolean {
  if (!Array.isArray(modes)) return false
  return modes.some((m: string) => ['hs', 'rgb', 'xy'].includes(m))
}

function supportsColorTemp(modes: unknown): boolean {
  if (!Array.isArray(modes)) return false
  return modes.includes('color_temp')
}

function isOnlyOnOff(modes: unknown): boolean {
  if (!Array.isArray(modes)) return false
  return modes.every((m: string) => m === 'onoff')
}

export function buildSubItems(
  entityId: string,
  entity: { state: string; attributes: Record<string, unknown> } | undefined
): SubItem[] | null {
  const domain = entityId.split('.')[0]
  const state = entity?.state ?? 'unknown'
  const attrs = entity?.attributes ?? {}

  switch (domain) {
    case 'light': {
      const modes = attrs.supported_color_modes
      const basicOnly = isOnlyOnOff(modes) && attrs.brightness == null

      const items: SubItem[] = [
        { label: 'Turn ON',  serviceCall: { domain: 'light', service: 'turn_on',  entityId } },
        { label: 'Turn OFF', serviceCall: { domain: 'light', service: 'turn_off', entityId } },
      ]
      if (basicOnly) return items

      for (const pct of [10, 25, 50, 75, 100]) {
        items.push({
          label: `Brightness ${pct}%`,
          serviceCall: { domain: 'light', service: 'turn_on', entityId, serviceData: { brightness_pct: pct } },
        })
      }

      if (supportsColor(modes)) {
        for (const color of COLORS) {
          items.push({
            label: color.label,
            serviceCall: { domain: 'light', service: 'turn_on', entityId, serviceData: { hs_color: color.hs } },
          })
        }
      } else if (supportsColorTemp(modes)) {
        items.push({ label: 'Warm white', serviceCall: { domain: 'light', service: 'turn_on', entityId, serviceData: { color_temp: 400 } } })
        items.push({ label: 'Cool white', serviceCall: { domain: 'light', service: 'turn_on', entityId, serviceData: { color_temp: 250 } } })
      }

      // Effects (WLED, MagicLight, etc.) — `effect_list` attr exposes them.
      // Always include "Solid" / "None" first so user can stop a running effect.
      const effectList = attrs.effect_list as string[] | undefined
      if (Array.isArray(effectList) && effectList.length > 0) {
        const current = attrs.effect as string | undefined
        // Pin "Solid"/"None" to the top if present, then the rest in source order.
        const stopFirst = effectList.find(e => /^(solid|none|off)$/i.test(e))
        const ordered = stopFirst
          ? [stopFirst, ...effectList.filter(e => e !== stopFirst)]
          : effectList
        for (const eff of ordered) {
          items.push({
            label: `Effect: ${eff}${current === eff ? ' *' : ''}`,
            serviceCall: { domain: 'light', service: 'turn_on', entityId, serviceData: { effect: eff } },
          })
        }
      }

      return items
    }

    case 'fan': {
      const features = (attrs?.supported_features as number) ?? 0
      const items: SubItem[] = [
        { label: 'Turn ON',  serviceCall: { domain: 'fan', service: 'turn_on',  entityId } },
        { label: 'Turn OFF', serviceCall: { domain: 'fan', service: 'turn_off', entityId } },
      ]
      if (features & 1) {
        for (const pct of [20, 40, 60, 80, 100]) {
          items.push({
            label: `Speed ${pct}%`,
            serviceCall: { domain: 'fan', service: 'set_percentage', entityId, serviceData: { percentage: pct } },
          })
        }
      }
      const presetModes = attrs?.preset_modes as string[] | undefined
      if ((features & 8) && presetModes) {
        const current = attrs?.preset_mode as string | undefined
        for (const mode of presetModes) {
          items.push({
            label: `Preset: ${mode}${current === mode ? ' *' : ''}`,
            serviceCall: { domain: 'fan', service: 'set_preset_mode', entityId, serviceData: { preset_mode: mode } },
          })
        }
      }
      if (features & 2) {
        items.push({ label: 'Oscillate on',  serviceCall: { domain: 'fan', service: 'oscillate', entityId, serviceData: { oscillating: true } } })
        items.push({ label: 'Oscillate off', serviceCall: { domain: 'fan', service: 'oscillate', entityId, serviceData: { oscillating: false } } })
      }
      return items
    }

    case 'cover': {
      const features = (attrs?.supported_features as number) ?? 0
      const items: SubItem[] = []
      if (features & 1) items.push({ label: 'Open',  serviceCall: { domain: 'cover', service: 'open_cover',  entityId } })
      if (features & 2) items.push({ label: 'Close', serviceCall: { domain: 'cover', service: 'close_cover', entityId } })
      if (features & 8) items.push({ label: 'Stop',  serviceCall: { domain: 'cover', service: 'stop_cover',  entityId } })
      if (features & 4) {
        for (const pos of [0, 25, 50, 75, 100]) {
          items.push({
            label: `Position ${pos}%`,
            serviceCall: { domain: 'cover', service: 'set_cover_position', entityId, serviceData: { position: pos } },
          })
        }
      }
      // Tilt controls (bits 16/32/64/128 = open_tilt/close_tilt/stop_tilt/set_tilt_pos)
      if (features & 16) items.push({ label: 'Open tilt',  serviceCall: { domain: 'cover', service: 'open_cover_tilt',  entityId } })
      if (features & 32) items.push({ label: 'Close tilt', serviceCall: { domain: 'cover', service: 'close_cover_tilt', entityId } })
      if (features & 128) {
        for (const pos of [0, 50, 100]) {
          items.push({
            label: `Tilt ${pos}%`,
            serviceCall: { domain: 'cover', service: 'set_cover_tilt_position', entityId, serviceData: { tilt_position: pos } },
          })
        }
      }
      return items.length === 0 ? null : items
    }

    case 'climate': {
      const features = (attrs?.supported_features as number) ?? 0
      const items: SubItem[] = [
        { label: 'Turn ON',  serviceCall: { domain: 'climate', service: 'turn_on',  entityId } },
        { label: 'Turn OFF', serviceCall: { domain: 'climate', service: 'turn_off', entityId } },
      ]

      const hvacModes = attrs?.hvac_modes as string[] | undefined
      if (hvacModes) {
        for (const mode of hvacModes) {
          if (mode === 'off') continue
          items.push({
            label: `Mode: ${mode}${state === mode ? ' *' : ''}`,
            serviceCall: { domain: 'climate', service: 'set_hvac_mode', entityId, serviceData: { hvac_mode: mode } },
          })
        }
      }

      // Temperature presets \u2014 use the entity's actual range + step instead of
      // a hardcoded 16-28\u00B0C. Skip if the device doesn't support TARGET_TEMPERATURE.
      if (features & 1) {
        const minT = Number(attrs?.min_temp ?? 16)
        const maxT = Number(attrs?.max_temp ?? 28)
        const step = Number(attrs?.target_temp_step ?? 1)
        const unit = (attrs?.temperature_unit as string) ?? '\u00B0C'
        for (let t = minT; t <= maxT + 1e-6; t += step) {
          const v = Number.isInteger(step) ? Math.round(t) : Number(t.toFixed(1))
          items.push({
            label: `${v}${unit.startsWith('\u00B0') ? unit : '\u00B0' + unit}`,
            serviceCall: { domain: 'climate', service: 'set_temperature', entityId, serviceData: { temperature: v } },
          })
        }
      }

      const fanModes = attrs?.fan_modes as string[] | undefined
      if ((features & 8) && fanModes) {
        for (const mode of fanModes) {
          items.push({
            label: `Fan: ${mode}${(attrs?.fan_mode as string) === mode ? ' *' : ''}`,
            serviceCall: { domain: 'climate', service: 'set_fan_mode', entityId, serviceData: { fan_mode: mode } },
          })
        }
      }

      const presetModes = attrs?.preset_modes as string[] | undefined
      if ((features & 16) && presetModes) {
        for (const mode of presetModes) {
          items.push({
            label: `Preset: ${mode}${(attrs?.preset_mode as string) === mode ? ' *' : ''}`,
            serviceCall: { domain: 'climate', service: 'set_preset_mode', entityId, serviceData: { preset_mode: mode } },
          })
        }
      }

      const swingModes = attrs?.swing_modes as string[] | undefined
      if ((features & 32) && swingModes) {
        for (const mode of swingModes) {
          items.push({
            label: `Swing: ${mode}${(attrs?.swing_mode as string) === mode ? ' *' : ''}`,
            serviceCall: { domain: 'climate', service: 'set_swing_mode', entityId, serviceData: { swing_mode: mode } },
          })
        }
      }

      return items
    }

    case 'input_select': {
      const options = (attrs?.options as string[] | undefined) ?? []
      if (options.length === 0) return null
      return options.map(opt => ({
        label: state === opt ? `${opt} *` : opt,
        serviceCall: { domain: 'input_select', service: 'select_option', entityId, serviceData: { option: opt } },
      }))
    }

    case 'input_number': {
      const min = Number(attrs?.min ?? 0)
      const max = Number(attrs?.max ?? 100)
      const step = Number(attrs?.step ?? 1)
      const span = max - min
      if (span <= 0) return null
      // Build 5–6 evenly-spaced presets (rounded to step).
      const presets = new Set<number>()
      presets.add(min)
      presets.add(max)
      for (const frac of [0.25, 0.5, 0.75]) {
        const raw = min + span * frac
        const snapped = min + Math.round((raw - min) / step) * step
        presets.add(snapped)
      }
      const sorted = [...presets].filter(v => v >= min && v <= max).sort((a, b) => a - b)
      const fmt = (v: number) => Number.isInteger(step) ? String(v) : v.toFixed(2)
      return sorted.map(v => ({
        label: `Set to ${fmt(v)}`,
        serviceCall: { domain: 'input_number', service: 'set_value', entityId, serviceData: { value: v } },
      }))
    }

    case 'counter': {
      return [
        { label: 'Increment', serviceCall: { domain: 'counter', service: 'increment', entityId } },
        { label: 'Decrement', serviceCall: { domain: 'counter', service: 'decrement', entityId } },
        { label: 'Reset',     serviceCall: { domain: 'counter', service: 'reset',     entityId } },
      ]
    }

    case 'timer': {
      return [
        { label: state === 'active' ? 'Pause' : 'Start', serviceCall: { domain: 'timer', service: state === 'active' ? 'pause' : 'start', entityId } },
        { label: 'Cancel', serviceCall: { domain: 'timer', service: 'cancel', entityId } },
        { label: 'Finish', serviceCall: { domain: 'timer', service: 'finish', entityId } },
      ]
    }

    case 'switch':
    case 'input_boolean': {
      return [
        { label: 'Turn ON',  serviceCall: { domain, service: 'turn_on',  entityId } },
        { label: 'Turn OFF', serviceCall: { domain, service: 'turn_off', entityId } },
      ]
    }

    case 'lock': {
      return [
        { label: 'Unlock', serviceCall: { domain: 'lock', service: 'unlock', entityId } },
        { label: 'Lock',   serviceCall: { domain: 'lock', service: 'lock',   entityId } },
      ]
    }

    // scene: no submenu — single action, no state. Domain default = instant.
    case 'script': {
      return [
        { label: 'Run',  serviceCall: { domain: 'script', service: 'turn_on', entityId } },
        { label: 'Stop', serviceCall: { domain: 'script', service: 'turn_off', entityId } },
      ]
    }
    case 'automation': {
      return [
        { label: 'Trigger', serviceCall: { domain: 'automation', service: 'trigger', entityId } },
        { label: state === 'on' ? 'Disable' : 'Enable', serviceCall: { domain: 'automation', service: state === 'on' ? 'turn_off' : 'turn_on', entityId } },
      ]
    }
    // button / input_button: no submenu — single fire-once. Domain default = instant.

    default:
      return null
  }
}

// Domain-level confirm policy. 'instant' = fire on click, 'confirm' = show
// confirm screen. Per-entity overrides in config.confirmModes win.
//   instant: low-risk toggles + fire-once triggers
//   confirm: security/disruptive (lock, alarm, garage cover, media, vacuum)
const INSTANT_DOMAINS = new Set([
  'scene', 'script', 'automation', 'button', 'input_button',
  'light', 'switch', 'fan', 'input_boolean',
  'counter', 'timer',
])
export function domainConfirmDefault(domain: string): 'instant' | 'confirm' {
  return INSTANT_DOMAINS.has(domain) ? 'instant' : 'confirm'
}

export function shouldConfirm(entityId: string, override: 'always' | 'never' | undefined): boolean {
  if (override === 'always') return true
  if (override === 'never') return false
  return domainConfirmDefault(entityId.split('.')[0]) === 'confirm'
}

export function defaultServiceCall(
  entityId: string,
  state: string
): { action: string; serviceCall: ServiceCall } {
  const domain = entityId.split('.')[0]
  switch (domain) {
    case 'lock':
      return {
        action: state === 'unlocked' ? 'Lock' : 'Unlock',
        serviceCall: { domain: 'lock', service: state === 'unlocked' ? 'lock' : 'unlock', entityId },
      }
    case 'scene':
    case 'script':
      return {
        action: 'Run',
        serviceCall: { domain, service: 'turn_on', entityId },
      }
    case 'automation':
      return {
        action: 'Trigger',
        serviceCall: { domain: 'automation', service: 'trigger', entityId },
      }
    case 'input_button':
    case 'button':
      return {
        action: 'Press',
        serviceCall: { domain, service: 'press', entityId },
      }
    default:
      return {
        action: state === 'on' ? 'Turn OFF' : 'Turn ON',
        serviceCall: { domain, service: state === 'on' ? 'turn_off' : 'turn_on', entityId },
      }
  }
}
