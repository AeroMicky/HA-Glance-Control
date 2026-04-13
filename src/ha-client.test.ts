import { describe, it, expect } from 'vitest'

// HAClient is tightly coupled to WebSocket, so we test the extractable logic
// rather than mocking the entire connection. These tests verify the pure
// decision-making that would otherwise only be caught by manual testing.

// We can't import HAClient directly without WebSocket, so we extract and test
// the logic patterns it uses.

describe('httpUrl derivation', () => {
  // This mirrors HAClient.httpUrl — testing the regex transform
  function deriveHttpUrl(wsUrl: string): string {
    return wsUrl.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/api\/websocket$/, '')
  }

  it('converts ws:// to http://', () => {
    expect(deriveHttpUrl('ws://homeassistant.local:8123/api/websocket'))
      .toBe('http://homeassistant.local:8123')
  })

  it('converts wss:// to https://', () => {
    expect(deriveHttpUrl('wss://abc123.ui.nabu.casa/api/websocket'))
      .toBe('https://abc123.ui.nabu.casa')
  })

  it('handles URL without /api/websocket suffix', () => {
    expect(deriveHttpUrl('ws://192.168.1.100:8123'))
      .toBe('http://192.168.1.100:8123')
  })

  it('preserves port numbers', () => {
    expect(deriveHttpUrl('wss://ha.local:8443/api/websocket'))
      .toBe('https://ha.local:8443')
  })
})

describe('entity domain extraction', () => {
  // This is the pattern used by toggle() and callService()
  function getDomain(entityId: string): string {
    return entityId.split('.')[0]
  }

  it('extracts domain from standard entity IDs', () => {
    expect(getDomain('light.living_room')).toBe('light')
    expect(getDomain('switch.pool_pump')).toBe('switch')
    expect(getDomain('climate.bedroom_ac')).toBe('climate')
    expect(getDomain('cover.garage_door')).toBe('cover')
  })

  it('handles entity IDs with multiple dots', () => {
    // Some integrations create entity IDs like sensor.something.extra
    expect(getDomain('sensor.temp.outdoor')).toBe('sensor')
  })
})

describe('toggle logic', () => {
  // Mirrors HAClient.toggle() decision tree
  function getToggleService(entityId: string, state: string): { domain: string; service: string } {
    const domain = entityId.split('.')[0]
    if (domain === 'cover') {
      return { domain, service: state === 'open' ? 'close_cover' : 'open_cover' }
    }
    if (domain === 'lock') {
      return { domain, service: state === 'unlocked' ? 'lock' : 'unlock' }
    }
    return { domain, service: 'toggle' }
  }

  it('closes open covers', () => {
    expect(getToggleService('cover.blinds', 'open').service).toBe('close_cover')
  })

  it('opens closed covers', () => {
    expect(getToggleService('cover.blinds', 'closed').service).toBe('open_cover')
  })

  it('locks unlocked locks', () => {
    expect(getToggleService('lock.front', 'unlocked').service).toBe('lock')
  })

  it('unlocks locked locks', () => {
    expect(getToggleService('lock.front', 'locked').service).toBe('unlock')
  })

  it('uses generic toggle for standard domains', () => {
    expect(getToggleService('light.lounge', 'on').service).toBe('toggle')
    expect(getToggleService('switch.pump', 'off').service).toBe('toggle')
  })
})

describe('todo item parsing', () => {
  // Mirrors the response parsing in getTodoItems
  function parseTodoItems(
    data: Record<string, unknown>,
    entityId: string
  ): Array<{ uid: string; summary: string; done: boolean }> {
    let entityObj = data[entityId] as Record<string, unknown> | undefined
    if (!entityObj) {
      const keys = Object.keys(data)
      if (keys.length > 0) entityObj = data[keys[0]] as Record<string, unknown>
    }
    const itemsArray = entityObj?.['items'] as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(itemsArray)) return []
    return itemsArray.map(item => ({
      uid: (item['uid'] || item['id']) as string,
      summary: item['summary'] as string,
      done: item['status'] === 'completed',
    }))
  }

  it('parses standard HA todo response', () => {
    const data = {
      'todo.shopping': {
        items: [
          { uid: '1', summary: 'Milk', status: 'needs_action' },
          { uid: '2', summary: 'Bread', status: 'completed' },
        ],
      },
    }
    const items = parseTodoItems(data, 'todo.shopping')
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({ uid: '1', summary: 'Milk', done: false })
    expect(items[1]).toEqual({ uid: '2', summary: 'Bread', done: true })
  })

  it('falls back to first key when entity_id key is missing', () => {
    // Some HA versions return different key formats
    const data = {
      'todo.grocery_list': {
        items: [{ uid: '1', summary: 'Eggs', status: 'needs_action' }],
      },
    }
    const items = parseTodoItems(data, 'todo.shopping')
    expect(items).toHaveLength(1)
    expect(items[0].summary).toBe('Eggs')
  })

  it('uses id field as fallback for uid', () => {
    const data = {
      'todo.tasks': {
        items: [{ id: 'abc', summary: 'Deploy', status: 'needs_action' }],
      },
    }
    const items = parseTodoItems(data, 'todo.tasks')
    expect(items[0].uid).toBe('abc')
  })

  it('returns empty array for missing/malformed data', () => {
    expect(parseTodoItems({}, 'todo.x')).toEqual([])
    expect(parseTodoItems({ 'todo.x': {} }, 'todo.x')).toEqual([])
    expect(parseTodoItems({ 'todo.x': { items: 'not an array' } }, 'todo.x')).toEqual([])
  })
})
