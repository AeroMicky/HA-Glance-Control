import { describe, it, expect } from 'vitest'
import { buildSubItems, defaultServiceCall } from './submenus'

// --- buildSubItems ---

describe('buildSubItems', () => {
  describe('lights', () => {
    it('returns null for on/off-only lights with no brightness', () => {
      const result = buildSubItems('light.basic', {
        state: 'on',
        attributes: { supported_color_modes: ['onoff'] },
      })
      expect(result).toBeNull()
    })

    it('returns brightness controls for dimmable lights', () => {
      const items = buildSubItems('light.lounge', {
        state: 'on',
        attributes: { supported_color_modes: ['brightness'] },
      })!
      expect(items).not.toBeNull()
      expect(items[0].label).toBe('Turn OFF')
      expect(items[0].serviceCall.service).toBe('turn_off')
      expect(items.find(i => i.label === 'Brightness 50%')).toBeDefined()
      expect(items.find(i => i.label === 'Brightness 100%')).toBeDefined()
    })

    it('shows Turn ON when light is off', () => {
      const items = buildSubItems('light.lounge', {
        state: 'off',
        attributes: { supported_color_modes: ['brightness'] },
      })!
      expect(items[0].label).toBe('Turn ON')
      expect(items[0].serviceCall.service).toBe('turn_on')
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
    it('returns speed controls', () => {
      const items = buildSubItems('fan.bedroom', {
        state: 'on',
        attributes: {},
      })!
      expect(items[0].label).toBe('Turn OFF')
      expect(items.find(i => i.label === 'Speed 60%')).toBeDefined()
      expect(items.find(i => i.label === 'Speed 100%')).toBeDefined()
    })
  })

  describe('covers', () => {
    it('returns open/close/stop without position when unsupported', () => {
      const items = buildSubItems('cover.garage', {
        state: 'closed',
        attributes: { supported_features: 0 },
      })!
      expect(items.map(i => i.label)).toEqual(['Open', 'Close', 'Stop'])
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
          hvac_modes: ['off', 'cool', 'heat', 'auto'],
          fan_modes: ['low', 'high'],
          fan_mode: 'low',
        },
      })!
      // Should have Turn OFF (since state !== 'off')
      expect(items[0].label).toBe('Turn OFF')
      // Should skip 'off' from hvac_modes list
      expect(items.find(i => i.label === 'Mode: off')).toBeUndefined()
      // Current mode marked with *
      expect(items.find(i => i.label === 'Mode: cool *')).toBeDefined()
      expect(items.find(i => i.label === 'Mode: heat')).toBeDefined()
      // Temperature range
      expect(items.find(i => i.label === '22\u00B0C')).toBeDefined()
      // Fan modes with current marked
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
