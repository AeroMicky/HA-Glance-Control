type HAStateChangedCallback = (entityId: string, state: string, attributes: Record<string, unknown>) => void

interface HAEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

export class HAClient {
  private ws: WebSocket | null = null
  private msgId = 1
  private pending = new Map<number, (result: unknown) => void>()
  private stateCallbacks: HAStateChangedCallback[] = []
  private entities = new Map<string, HAEntity>()
  private entityAreas = new Map<string, string>()
  private areaNames = new Map<string, string>()
  private url: string
  private token: string

  constructor(url: string, token: string) {
    this.url = url
    this.token = token
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('[HA] Connecting to:', this.url)

      try {
        this.ws = new WebSocket(this.url)
      } catch (err) {
        reject(new Error(`Invalid WebSocket URL: ${err}`))
        return
      }

      this.ws.onopen = () => console.log('[HA] WebSocket opened, waiting for auth_required...')

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        console.log('[HA] Message:', msg.type)
        this.handleMessage(msg, resolve, reject)
      }

      this.ws.onerror = (event) => {
        console.error('[HA] WebSocket error:', event)
        reject(new Error(`WebSocket error connecting to ${this.url} — check URL, network, and browser console`))
      }

      this.ws.onclose = (event) => {
        console.log('[HA] WebSocket closed:', event.code, event.reason)
        this.ws = null
      }
    })
  }

  private handleMessage(msg: Record<string, unknown>, onReady: () => void, onFail: (err: Error) => void) {
    switch (msg.type) {
      case 'auth_required':
        console.log('[HA] Auth required, sending token...')
        this.send({ type: 'auth', access_token: this.token })
        break

      case 'auth_ok':
        console.log('[HA] Auth OK, fetching states...')
        this.subscribeStateChanges()
        Promise.all([this.fetchStates(), this.fetchAreas()]).then(() => onReady())
        break

      case 'auth_invalid':
        console.error('[HA] Auth invalid:', msg.message)
        onFail(new Error(`Auth failed: ${msg.message}`))
        break

      case 'result': {
        const id = msg.id as number
        const cb = this.pending.get(id)
        if (cb) {
          this.pending.delete(id)
          cb(msg.result)
        }
        break
      }

      case 'event': {
        const event = msg.event as Record<string, unknown>
        if (event.event_type === 'state_changed') {
          const data = event.data as Record<string, unknown>
          const newState = data.new_state as HAEntity
          if (newState) {
            this.entities.set(newState.entity_id, newState)
            this.stateCallbacks.forEach(cb =>
              cb(newState.entity_id, newState.state, newState.attributes)
            )
          }
        }
        break
      }
    }
  }

  private send(msg: Record<string, unknown>) {
    this.ws?.send(JSON.stringify(msg))
  }

  private sendCommand(msg: Record<string, unknown>): Promise<unknown> {
    const id = this.msgId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.send({ ...msg, id })
    })
  }

  private async fetchStates() {
    const states = await this.sendCommand({ type: 'get_states' }) as HAEntity[]
    for (const entity of states) {
      this.entities.set(entity.entity_id, entity)
    }
  }

  private async fetchAreas() {
    // Fetch area registry
    const areas = await this.sendCommand({ type: 'config/area_registry/list' }) as Array<{ area_id: string; name: string }>
    for (const area of areas) {
      this.areaNames.set(area.area_id, area.name)
    }
    // Fetch entity registry to map entities to areas/devices
    const entities = await this.sendCommand({ type: 'config/entity_registry/list' }) as Array<{ entity_id: string; area_id?: string; device_id?: string }>
    // Fetch device registry to get device->area mapping
    const devices = await this.sendCommand({ type: 'config/device_registry/list' }) as Array<{ id: string; area_id?: string }>
    const deviceAreaMap = new Map<string, string>()
    for (const dev of devices) {
      if (dev.area_id) deviceAreaMap.set(dev.id, dev.area_id)
    }
    // Map each entity to its area (direct or via device)
    for (const ent of entities) {
      const areaId = ent.area_id || (ent.device_id ? deviceAreaMap.get(ent.device_id) : undefined)
      if (areaId) {
        const areaName = this.areaNames.get(areaId)
        if (areaName) this.entityAreas.set(ent.entity_id, areaName)
      }
    }
    console.log(`[HA] Loaded ${this.areaNames.size} areas, ${this.entityAreas.size} entity-area mappings`)
  }

  getEntityArea(entityId: string): string | undefined {
    return this.entityAreas.get(entityId)
  }

  private subscribeStateChanges() {
    this.sendCommand({
      type: 'subscribe_events',
      event_type: 'state_changed',
    })
  }

  onStateChanged(cb: HAStateChangedCallback) {
    this.stateCallbacks.push(cb)
  }

  getEntity(entityId: string): HAEntity | undefined {
    return this.entities.get(entityId)
  }

  getEntitiesByDomain(domain: string): HAEntity[] {
    const result: HAEntity[] = []
    for (const [id, entity] of this.entities) {
      if (id.startsWith(domain + '.')) result.push(entity)
    }
    return result.sort((a, b) => a.entity_id.localeCompare(b.entity_id))
  }

  async callService(domain: string, service: string, entityId: string): Promise<boolean> {
    try {
      await this.sendCommand({
        type: 'call_service',
        domain,
        service,
        service_data: { entity_id: entityId },
      })
      return true
    } catch {
      return false
    }
  }

  async toggle(entityId: string): Promise<boolean> {
    const domain = entityId.split('.')[0]
    return this.callService(domain, 'toggle', entityId)
  }
}
