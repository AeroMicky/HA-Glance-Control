type HAStateChangedCallback = (entityId: string, state: string, attributes: Record<string, unknown>) => void
type ConnectionCallback = (connected: boolean) => void

interface HAEntity {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
}

export interface TodoItem {
  uid: string
  summary: string
  description?: string
  due?: string
  done: boolean // true if status === 'completed'
}

export class HAClient {
  private ws: WebSocket | null = null
  private msgId = 1
  private pending = new Map<number, (result: unknown) => void>()
  private stateCallbacks: HAStateChangedCallback[] = []
  private connectionCallbacks: ConnectionCallback[] = []
  private entities = new Map<string, HAEntity>()
  private entityAreas = new Map<string, string>()
  private areaNames = new Map<string, string>()
  private url: string
  private token: string
  private deliberateDisconnect = false
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

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
        if (!this.deliberateDisconnect) {
          this.connectionCallbacks.forEach(cb => cb(false))
          this.scheduleReconnect()
        }
      }
    })
  }

  disconnect() {
    this.deliberateDisconnect = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
  }

  onConnectionChange(cb: ConnectionCallback) {
    this.connectionCallbacks.push(cb)
  }

  private scheduleReconnect() {
    if (this.deliberateDisconnect) return
    console.log(`[HA] Reconnecting in ${this.reconnectDelay}ms...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect()
        .then(() => {
          this.reconnectDelay = 1000
          this.connectionCallbacks.forEach(cb => cb(true))
        })
        .catch(() => this.scheduleReconnect())
    }, this.reconnectDelay)
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
        const success = msg.success as boolean
        console.log(`[HA] Result id=${id} success=${success}`)
        const cb = this.pending.get(id)
        if (cb) {
          this.pending.delete(id)
          cb(success ? msg.result : null)
        }
        break
      }

      case 'event': {
        const event = msg.event as Record<string, unknown>
        if (event.event_type === 'state_changed') {
          const data = event.data as Record<string, unknown>
          const newState = data.new_state as HAEntity | null
          const entityId = (data.entity_id as string) ?? (newState?.entity_id)
          if (newState) {
            this.entities.set(newState.entity_id, newState)
            this.stateCallbacks.forEach(cb =>
              cb(newState.entity_id, newState.state, newState.attributes)
            )
          } else if (entityId) {
            // Entity deleted — remove from cache
            this.entities.delete(entityId)
            this.stateCallbacks.forEach(cb => cb(entityId, '', {}))
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
    const areas = await this.sendCommand({ type: 'config/area_registry/list' }) as Array<{ area_id: string; name: string }>
    for (const area of areas) {
      this.areaNames.set(area.area_id, area.name)
    }
    const entities = await this.sendCommand({ type: 'config/entity_registry/list' }) as Array<{ entity_id: string; area_id?: string; device_id?: string }>
    const devices = await this.sendCommand({ type: 'config/device_registry/list' }) as Array<{ id: string; area_id?: string }>
    const deviceAreaMap = new Map<string, string>()
    for (const dev of devices) {
      if (dev.area_id) deviceAreaMap.set(dev.id, dev.area_id)
    }
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

  async callServiceWithData(
    domain: string,
    service: string,
    entityId: string,
    serviceData?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      await this.sendCommand({
        type: 'call_service',
        domain,
        service,
        service_data: { entity_id: entityId, ...serviceData },
      })
      return true
    } catch {
      return false
    }
  }

  async toggle(entityId: string): Promise<boolean> {
    const domain = entityId.split('.')[0]
    if (domain === 'cover') {
      const entity = this.entities.get(entityId)
      const service = entity?.state === 'open' ? 'close_cover' : 'open_cover'
      return this.callService(domain, service, entityId)
    }
    if (domain === 'lock') {
      const entity = this.entities.get(entityId)
      const service = entity?.state === 'unlocked' ? 'lock' : 'unlock'
      return this.callService(domain, service, entityId)
    }
    return this.callService(domain, 'toggle', entityId)
  }

  getTodoEntities(): HAEntity[] {
    return this.getEntitiesByDomain('todo')
  }

  private get httpUrl(): string {
    return this.url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/api\/websocket$/, '')
  }

  async getTodoItems(entityId: string): Promise<TodoItem[]> {
    // Use REST API — more reliable than WebSocket call_service in WebView
    try {
      console.log(`[HA] getTodoItems REST for ${entityId}`)
      const resp = await fetch(`${this.httpUrl}/api/services/todo/get_items`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entity_id: entityId }),
      })
      if (!resp.ok) {
        console.error(`[HA] REST todo/get_items failed: ${resp.status}`)
        return this.getTodoItemsWS(entityId)
      }
      const data = await resp.json()
      console.log(`[HA] REST response:`, JSON.stringify(data).substring(0, 200))

      // REST response: { "todo.entity_id": { "items": [...] } }
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
        description: item['description'] as string | undefined,
        due: item['due'] as string | undefined,
        done: item['status'] === 'completed',
      }))
    } catch (err) {
      console.error(`[HA] REST getTodoItems failed:`, err)
      return this.getTodoItemsWS(entityId)
    }
  }

  private async getTodoItemsWS(entityId: string): Promise<TodoItem[]> {
    try {
      const response = await this.sendCommand({
        type: 'call_service',
        domain: 'todo',
        service: 'get_items',
        service_data: { entity_id: entityId },
        return_response: true,
      })
      if (!response) return []
      const res = response as Record<string, unknown>
      const responseObj = res['response'] as Record<string, unknown> | undefined
      if (!responseObj) return []
      let entityObj = responseObj[entityId] as Record<string, unknown> | undefined
      if (!entityObj) {
        const keys = Object.keys(responseObj)
        if (keys.length > 0) entityObj = responseObj[keys[0]] as Record<string, unknown>
      }
      const itemsArray = entityObj?.['items'] as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(itemsArray)) return []
      return itemsArray.map(item => ({
        uid: (item['uid'] || item['id']) as string,
        summary: item['summary'] as string,
        description: item['description'] as string | undefined,
        due: item['due'] as string | undefined,
        done: item['status'] === 'completed',
      }))
    } catch (err) {
      console.error(`[HA] WS getTodoItems failed:`, err)
      return []
    }
  }

  async updateTodoItem(entityId: string, uid: string, done: boolean): Promise<boolean> {
    return this.callServiceWithData('todo', 'update_item', entityId, {
      item: uid,
      status: done ? 'completed' : 'needs_action',
    })
  }

  async editTodoItem(
    entityId: string,
    uid: string,
    updates: { rename?: string; description?: string; due?: string | null; done?: boolean }
  ): Promise<boolean> {
    const data: Record<string, unknown> = { item: uid }
    if (updates.rename !== undefined) data.rename = updates.rename
    if (updates.description !== undefined) data.description = updates.description
    if (updates.done !== undefined) data.status = updates.done ? 'completed' : 'needs_action'
    if (updates.due !== undefined) {
      if (updates.due === null || updates.due === '') {
        // Clear due — HA accepts empty string for both fields to clear
        data.due_datetime = ''
      } else if (updates.due.includes('T')) {
        data.due_datetime = updates.due
      } else {
        data.due_date = updates.due
      }
    }
    return this.callServiceWithData('todo', 'update_item', entityId, data)
  }

  async removeTodoItem(entityId: string, uid: string): Promise<boolean> {
    return this.callServiceWithData('todo', 'remove_item', entityId, { item: uid })
  }

  async addTodoItem(entityId: string, summary: string, description?: string, due?: string): Promise<boolean> {
    const data: Record<string, unknown> = { item: summary }
    if (description) data.description = description
    if (due) {
      // "YYYY-MM-DD" → due_date; "YYYY-MM-DDTHH:mm[:ss]" → due_datetime
      if (due.includes('T')) data.due_datetime = due
      else data.due_date = due
    }
    return this.callServiceWithData('todo', 'add_item', entityId, data)
  }
}
