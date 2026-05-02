import { describe, it, expect } from 'vitest'
import { buildSubItems, defaultServiceCall } from './submenus'

// --- buildSubItems ---

describe('buildSubItems', () => {
  describe('lights', () => {
    it('returns minimal on/off submenu for basic lights', () => {
      const items = buildSubItems('light.basic', {
        state: 'on',
        attributes: { supported_color_modes: ['onoff'] },
      })!
      expect(items.map(i => i.label)).toEqual(['Turn ON', 'Turn OFF'])
    })

    it('returns brightness controls for dimmable lights', () => {
      const items = buildSubItems('light.lounge', {
        state: 'on',
        attributes: { supported_color_modes: ['brightness'] },
      })!
      expect(items).not.toBeNull()
      expect(items[0].label).toBe('Turn ON')
      expect(items[1].label).toBe('Turn OFF')
      expect(items.find(i => i.label === 'Brightness 50%')).toBeDefined()
      expect(items.find(i => i.label === 'Brightness 100%')).toBeDefined()
    })

    it('exposes both Turn ON and Turn OFF regardless of state', () => {
      const items = buildSubItems('light.lounge', {
        state: 'off',
        attributes: { supported_color_modes: ['brightness'] },
      })!
      expect(items.find(i => i.label === 'Turn ON')).toBeDefined()
      expect(items.find(i => i.label === 'Turn OFF')).toBeDefined()
    })

    it('includes color options for hs-capable lights', () => {
      const items = buildSubItems('light.rgb', {
        state: 'on',
        attributes: { supported_color_modes: ['hs', 'brightness'] },
      })!
      expect(items.find(i => i.label === 'Red')).toBeDefined()
      expect(items.find(i => i.label === 'Blue')).toBeDefined()
      expect(items.find(i => i.label === 'Warm white')).toBeDefined()
      // Color service calls should have hs_color data
      const red = items.find(i => i.label === 'Red')!
      expect(red.serviceCall.serviceData).toEqual({ hs_color: [0, 100] })
    })

    it('includes color temp options for color_temp-only lights', () => {
      const items = buildSubItems('light.kitchen', {
        state: 'on',
        attributes: { supported_color_modes: ['color_temp', 'brightness'] },
      })!
      expect(items.find(i => i.label === 'Warm white')).toBeDefined()
      expect(items.find(i => i.label === 'Cool white')).toBeDefined()
      // Should NOT have full color palette
      expect(items.find(i => i.label === 'Red')).toBeUndefined()
    })

    it('handles missing attributes gracefully', () => {
      const items = buildSubItems('light.broken', undefined)
      // undefined entity — buildSubItems uses attrs ?? {} and state ?? 'unknown'
      // supported_color_modes will be undefined, isOnlyOnOff returns false
      // so it returns items (turn on + brightness)
      expect(items).not.toBeNull()
    })
  })

  describe('fans', () => {
    it('returns speed controls when SET_SPEED supported', () => {
      const items = buildSubItems('fan.bedroom', {
        state: 'on',
        attributes: { supported_features: 1 },
      })!
      expect(items[0].label).toBe('Turn ON')
      expect(items[1].label).toBe('Turn OFF')
      expect(items.find(i => i.label === 'Speed 60%')).toBeDefined()
      expect(items.find(i => i.label === 'Speed 100%')).toBeDefined()
    })

    it('omits speed presets when SET_SPEED not supported', () => {
      const items = buildSubItems('fan.basic', {
        state: 'on',
        attributes: { supported_features: 0 },
      })!
      expect(items.find(i => i.label?.startsWith('Speed '))).toBeUndefined()
    })
  })

  describe('covers', () => {
    it('returns open/close/stop when those bits are set', () => {
      const items = buildSubItems('cover.garage', {
        state: 'closed',
        attributes: { supported_features: 1 | 2 | 8 },
      })!
      expect(items.map(i => i.label)).toEqual(['Open', 'Close', 'Stop'])
    })

    it('returns null when no cover features supported', () => {
      const items = buildSubItems('cover.deadbolt', {
        state: 'closed',
        attributes: { supported_features: 0 },
      })
      expect(items).toBeNull()
    })

    it('includes position controls when supported (bit 2)', () => {
      const items = buildSubItems('cover.blinds', {
        state: 'open',
        attributes: { supported_features: 4 }, // bit 2 = set_position
      })!
      expect(items.find(i => i.label === 'Position 50%')).toBeDefined()
      expect(items.find(i => i.label === 'Position 0%')).toBeDefined()
    })
  })

  describe('climate', () => {
    it('returns HVAC modes from entity attributes', () => {
      const items = buildSubItems('climate.ac', {
        state: 'cool',
        attributes: {
          // bit 1 = TARGET_TEMPERATURE, bit 8 = FAN_MODE
          supported_features: 1 | 8,
          hvac_modes: ['off', 'cool', 'heat', 'auto'],
          fan_modes: ['low', 'high'],
          fan_mode: 'low',
          min_temp: 16,
          max_temp: 28,
          target_temp_step: 1,
        },
      })!
      expect(items.find(i => i.label === 'Turn ON')).toBeDefined()
      expect(items.find(i => i.label === 'Turn OFF')).toBeDefined()
      expect(items.find(i => i.label === 'Mode: off')).toBeUndefined()
      expect(items.find(i => i.label === 'Mode: cool *')).toBeDefined()
      expect(items.find(i => i.label === 'Mode: heat')).toBeDefined()
      expect(items.find(i => i.label === '22\u00B0C')).toBeDefined()
      expect(items.find(i => i.label === 'Fan: low *')).toBeDefined()
      expect(items.find(i => i.label === 'Fan: high')).toBeDefined()
    })

    it('shows Turn ON when state is off', () => {
      const items = buildSubItems('climate.ac', {
        state: 'off',
        attributes: {},
      })!
      expect(items[0].label).toBe('Turn ON')
    })
  })

  describe('unsupported domains', () => {
    it('returns null for unknown domains', () => {
      expect(buildSubItems('sensor.temp', { state: '22', attributes: {} })).toBeNull()
      expect(buildSubItems('binary_sensor.door', { state: 'on', attributes: {} })).toBeNull()
    })
  })
})

// --- defaultServiceCall ---

describe('defaultServiceCall', () => {
  it('toggles generic entities', () => {
    const on = defaultServiceCall('switch.pump', 'on')
    expect(on.action).toBe('Turn OFF')
    expect(on.serviceCall.service).toBe('turn_off')

    const off = defaultServiceCall('switch.pump', 'off')
    expect(off.action).toBe('Turn ON')
    expect(off.serviceCall.service).toBe('turn_on')
  })

  it('locks/unlocks correctly', () => {
    const unlocked = defaultServiceCall('lock.front', 'unlocked')
    expect(unlocked.action).toBe('Lock')
    expect(unlocked.serviceCall.service).toBe('lock')

    const locked = defaultServiceCall('lock.front', 'locked')
    expect(locked.action).toBe('Unlock')
    expect(locked.serviceCall.service).toBe('unlock')
  })

  it('runs scenes and scripts', () => {
    const scene = defaultServiceCall('scene.movie', 'off')
    expect(scene.action).toBe('Run')
    expect(scene.serviceCall.service).toBe('turn_on')

    const script = defaultServiceCall('script.backup', 'off')
    expect(script.action).toBe('Run')
    expect(script.serviceCall.service).toBe('turn_on')
  })

  it('triggers automations', () => {
    const automation = defaultServiceCall('automation.morning_routine', 'on')
    expect(automation.action).toBe('Trigger')
    expect(automation.serviceCall.domain).toBe('automation')
    expect(automation.serviceCall.service).toBe('trigger')
  })

  it('always targets the correct entity', () => {
    const result = defaultServiceCall('switch.pool_pump', 'off')
    expect(result.serviceCall.entityId).toBe('switch.pool_pump')
    expect(result.serviceCall.domain).toBe('switch')
  })
})
