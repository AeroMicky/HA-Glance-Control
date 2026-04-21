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
      // No submenu for basic on/off only lights
      if (isOnlyOnOff(modes) && attrs.brightness == null) return null

      const items: SubItem[] = [
        {
          label: state === 'on' ? 'Turn OFF' : 'Turn ON',
          serviceCall: { domain: 'light', service: state === 'on' ? 'turn_off' : 'turn_on', entityId },
        },
      ]

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

      return items
    }

    case 'fan': {
      const items: SubItem[] = [
        {
          label: state === 'on' ? 'Turn OFF' : 'Turn ON',
          serviceCall: { domain: 'fan', service: state === 'on' ? 'turn_off' : 'turn_on', entityId },
        },
      ]
      for (const pct of [20, 40, 60, 80, 100]) {
        items.push({
          label: `Speed ${pct}%`,
          serviceCall: { domain: 'fan', service: 'set_percentage', entityId, serviceData: { percentage: pct } },
        })
      }
      return items
    }

    case 'cover': {
      const items: SubItem[] = [
        { label: 'Open',  serviceCall: { domain: 'cover', service: 'open_cover',  entityId } },
        { label: 'Close', serviceCall: { domain: 'cover', service: 'close_cover', entityId } },
        { label: 'Stop',  serviceCall: { domain: 'cover', service: 'stop_cover',  entityId } },
      ]
      // Only show position controls if the cover supports it (bit 2 of supported_features)
      const features = (attrs?.supported_features as number) ?? 0
      const supportsPosition = (features & 4) !== 0
      if (supportsPosition) {
        for (const pos of [0, 25, 50, 75, 100]) {
          items.push({
            label: `Position ${pos}%`,
            serviceCall: { domain: 'cover', service: 'set_cover_position', entityId, serviceData: { position: pos } },
          })
        }
      }
      return items
    }

    case 'climate': {
      const items: SubItem[] = [
        {
          label: state === 'off' ? 'Turn ON' : 'Turn OFF',
          serviceCall: { domain: 'climate', service: state === 'off' ? 'turn_on' : 'turn_off', entityId },
        },
      ]

      // HVAC modes
      const hvacModes = attrs?.hvac_modes as string[] | undefined
      if (hvacModes) {
        for (const mode of hvacModes) {
          if (mode === 'off') continue
          const current = state === mode ? ' *' : ''
          items.push({
            label: `Mode: ${mode}${current}`,
            serviceCall: { domain: 'climate', service: 'set_hvac_mode', entityId, serviceData: { hvac_mode: mode } },
          })
        }
      }

      // Temperature
      for (let temp = 16; temp <= 28; temp++) {
        items.push({
          label: `${temp}\u00B0C`,
          serviceCall: { domain: 'climate', service: 'set_temperature', entityId, serviceData: { temperature: temp } },
        })
      }

      // Fan modes
      const fanModes = attrs?.fan_modes as string[] | undefined
      if (fanModes) {
        for (const mode of fanModes) {
          const current = (attrs?.fan_mode as string) === mode ? ' *' : ''
          items.push({
            label: `Fan: ${mode}${current}`,
            serviceCall: { domain: 'climate', service: 'set_fan_mode', entityId, serviceData: { fan_mode: mode } },
          })
        }
      }

      return items
    }

    default:
      return null
  }
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
    default:
      return {
        action: state === 'on' ? 'Turn OFF' : 'Turn ON',
        serviceCall: { domain, service: state === 'on' ? 'turn_off' : 'turn_on', entityId },
      }
  }
}
