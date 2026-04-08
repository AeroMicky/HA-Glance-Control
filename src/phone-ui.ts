import { HAClient } from './ha-client'
import { getConfig, saveConfig, loadConfig } from './store'
import type { AppConfig, FavoriteConfig, DashboardSlot } from './store'

const CONTROLLABLE_DOMAINS = ['light', 'switch', 'fan', 'cover', 'scene', 'script', 'input_boolean']
const SENSOR_DOMAINS = ['sensor', 'binary_sensor']

type Tab = 'connection' | 'favorites' | 'rooms' | 'dashboard'

export class PhoneUI {
  private ha: HAClient | null = null
  private root: HTMLElement
  private tab: Tab = 'connection'
  private onConnect: (ha: HAClient) => void

  constructor(root: HTMLElement, onConnect: (ha: HAClient) => void) {
    this.root = root
    this.onConnect = onConnect
    loadConfig().then(() => this.render())
  }

  render() {
    const config = getConfig()
    const connected = this.ha !== null

    this.root.innerHTML = `
      <div class="app">
        <header>
          <h1>HA Glasses <small style="opacity:0.5">v0.4</small></h1>
          <span class="status ${connected ? 'on' : 'off'}">${connected ? 'Connected' : 'Disconnected'}</span>
        </header>
        <nav>
          ${this.tabBtn('connection', 'Setup')}
          ${this.tabBtn('favorites', 'Favorites')}
          ${this.tabBtn('rooms', 'Rooms')}
          ${this.tabBtn('dashboard', 'Dashboard')}
        </nav>
        <main id="tab-content"></main>
      </div>
    `

    this.root.querySelectorAll('nav button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.tab = btn.getAttribute('data-tab') as Tab
        this.render()
      })
    })

    const content = this.root.querySelector('#tab-content') as HTMLElement
    switch (this.tab) {
      case 'connection': this.renderConnection(content, config); break
      case 'favorites': this.renderFavorites(content, config); break
      case 'rooms': this.renderRooms(content, config); break
      case 'dashboard': this.renderDashboard(content, config); break
    }
  }

  setHA(ha: HAClient) {
    this.ha = ha
    this.render()
  }

  private tabBtn(id: Tab, label: string): string {
    const cls = this.tab === id ? 'tab active' : 'tab'
    return `<button class="${cls}" data-tab="${id}">${label}</button>`
  }

  private renderConnection(el: HTMLElement, config: AppConfig) {
    const connected = this.ha !== null
    el.innerHTML = `
      <section>
        <label>Home Assistant URL</label>
        <input id="ha-url" type="text" placeholder="wss://xxxxx.ui.nabu.casa/api/websocket"
               value="${this.escHtml(config.ha_url)}" ${connected ? 'disabled' : ''}>
        <label>Long-Lived Access Token</label>
        <input id="ha-token" type="password" placeholder="Paste token from HA Profile"
               value="${this.escHtml(config.ha_token)}" ${connected ? 'disabled' : ''}>
        <button id="connect-btn" class="primary">${connected ? 'Reconnect' : 'Connect'}</button>
        <p id="connect-status"></p>
      </section>
    `

    el.querySelector('#connect-btn')!.addEventListener('click', () => this.handleConnect(el))
  }

  private async handleConnect(el: HTMLElement) {
    const url = (el.querySelector('#ha-url') as HTMLInputElement).value.trim()
    const token = (el.querySelector('#ha-token') as HTMLInputElement).value.trim()
    const status = el.querySelector('#connect-status') as HTMLElement

    if (!url || !token) {
      status.textContent = 'URL and token are required'
      return
    }

    status.textContent = 'Connecting...'
    saveConfig({ ha_url: url, ha_token: token })

    try {
      const ha = new HAClient(url, token)
      await ha.connect()
      this.ha = ha
      this.onConnect(ha)
      status.textContent = 'Connected!'
      this.render()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      status.innerHTML = `Failed: ${msg}<br><br><small>Common fixes:<br>
        - URL must start with wss:// (Nabu Casa) or ws:// (local)<br>
        - URL must end with /api/websocket<br>
        - Check browser console (F12) for details</small>`
    }
  }

  private renderFavorites(el: HTMLElement, config: AppConfig) {
    if (!this.ha) {
      el.innerHTML = '<p class="hint">Connect to Home Assistant first</p>'
      return
    }

    const entities = this.getControllableEntities()
    const favIds = new Set(config.favorites.map(f => f.entity_id))

    el.innerHTML = `
      <section>
        <h2>Favorites (${config.favorites.length}/8)</h2>
        <p class="hint">These appear first on your glasses. Tap to add/remove.</p>
        <div id="fav-list" class="entity-list">
          ${config.favorites.map(f => `
            <div class="entity-row selected" data-id="${f.entity_id}">
              <span class="star">★</span>
              <span class="name">${this.escHtml(f.label)}</span>
              <span class="id">${f.entity_id}</span>
            </div>
          `).join('')}
        </div>
        <h3>Available Entities</h3>
        <input id="entity-search" type="text" placeholder="Filter entities...">
        <div id="available-list" class="entity-list">
          ${entities.filter(e => !favIds.has(e.entity_id)).map(e => `
            <div class="entity-row" data-id="${e.entity_id}">
              <span class="star">☆</span>
              <span class="name">${this.escHtml(this.friendlyName(e.entity_id))}</span>
              <span class="id">${e.entity_id}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `

    el.querySelector('#entity-search')!.addEventListener('input', (ev) => {
      const q = (ev.target as HTMLInputElement).value.toLowerCase()
      el.querySelectorAll('#available-list .entity-row').forEach(row => {
        const text = row.textContent?.toLowerCase() ?? ''
        ;(row as HTMLElement).style.display = text.includes(q) ? '' : 'none'
      })
    })

    el.querySelectorAll('.entity-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id')!
        const current = getConfig().favorites
        const exists = current.find(f => f.entity_id === id)
        if (exists) {
          saveConfig({ favorites: current.filter(f => f.entity_id !== id) })
        } else if (current.length < 8) {
          saveConfig({ favorites: [...current, { entity_id: id, label: this.friendlyName(id) }] })
        }
        this.render()
      })
    })
  }

  private renderRooms(el: HTMLElement, config: AppConfig) {
    if (!this.ha) {
      el.innerHTML = '<p class="hint">Connect to Home Assistant first</p>'
      return
    }

    const haRooms = this.getHARooms()
    const configuredRooms = config.rooms

    el.innerHTML = `
      <section>
        <h2>Rooms</h2>
        <p class="hint">Rooms from Home Assistant areas. Tap to include/exclude entities.</p>
        ${Object.entries(haRooms).map(([room, entityIds]) => {
          const included = configuredRooms[room] ?? []
          const includedSet = new Set(included)
          return `
            <div class="room-block">
              <h3>${this.escHtml(room)} <span class="count">${included.length}/${entityIds.length}</span></h3>
              <div class="entity-list">
                ${entityIds.map(id => `
                  <div class="entity-row ${includedSet.has(id) ? 'selected' : ''}" data-room="${this.escHtml(room)}" data-id="${id}">
                    <span class="check">${includedSet.has(id) ? '■' : '□'}</span>
                    <span class="name">${this.escHtml(this.friendlyName(id))}</span>
                  </div>
                `).join('')}
                <button class="small" data-room-all="${this.escHtml(room)}">Select All</button>
              </div>
            </div>
          `
        }).join('')}
        ${Object.keys(haRooms).length === 0 ? '<p class="hint">No areas configured in Home Assistant. Assign entities to areas in HA to see them here.</p>' : ''}
      </section>
    `

    el.querySelectorAll('.entity-row[data-room]').forEach(row => {
      row.addEventListener('click', () => {
        const room = row.getAttribute('data-room')!
        const id = row.getAttribute('data-id')!
        const rooms = { ...getConfig().rooms }
        const current = rooms[room] ?? []
        if (current.includes(id)) {
          rooms[room] = current.filter(x => x !== id)
        } else {
          rooms[room] = [...current, id]
        }
        if (rooms[room].length === 0) delete rooms[room]
        saveConfig({ rooms })
        this.render()
      })
    })

    el.querySelectorAll('button[data-room-all]').forEach(btn => {
      btn.addEventListener('click', () => {
        const room = btn.getAttribute('data-room-all')!
        const rooms = { ...getConfig().rooms }
        rooms[room] = [...(haRooms[room] ?? [])]
        saveConfig({ rooms })
        this.render()
      })
    })
  }

  private renderDashboard(el: HTMLElement, config: AppConfig) {
    if (!this.ha) {
      el.innerHTML = '<p class="hint">Connect to Home Assistant first</p>'
      return
    }

    const sensors = this.getSensorEntities()
    const slotIds = new Set(config.dashboard.map(s => s.entity_id))

    el.innerHTML = `
      <section>
        <h2>Dashboard Sensors (${config.dashboard.length}/6)</h2>
        <p class="hint">Shown as a glanceable readout on your glasses.</p>
        <div id="slot-list" class="entity-list">
          ${config.dashboard.map(s => `
            <div class="entity-row selected" data-id="${s.entity_id}">
              <span class="star">★</span>
              <span class="name">${this.escHtml(s.label)}</span>
              <span class="unit">${this.escHtml(s.unit)}</span>
              <span class="id">${s.entity_id}</span>
            </div>
          `).join('')}
        </div>
        <h3>Available Sensors</h3>
        <input id="sensor-search" type="text" placeholder="Filter sensors...">
        <div id="sensor-list" class="entity-list">
          ${sensors.filter(e => !slotIds.has(e.entity_id)).map(e => `
            <div class="entity-row" data-id="${e.entity_id}">
              <span class="star">☆</span>
              <span class="name">${this.escHtml(this.friendlyName(e.entity_id))}</span>
              <span class="unit">${this.escHtml(this.guessUnit(e))}</span>
              <span class="id">${e.entity_id}</span>
            </div>
          `).join('')}
        </div>
      </section>
    `

    el.querySelector('#sensor-search')!.addEventListener('input', (ev) => {
      const q = (ev.target as HTMLInputElement).value.toLowerCase()
      el.querySelectorAll('#sensor-list .entity-row').forEach(row => {
        const text = row.textContent?.toLowerCase() ?? ''
        ;(row as HTMLElement).style.display = text.includes(q) ? '' : 'none'
      })
    })

    el.querySelectorAll('.entity-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id')!
        const current = getConfig().dashboard
        const exists = current.find(s => s.entity_id === id)
        if (exists) {
          saveConfig({ dashboard: current.filter(s => s.entity_id !== id) })
        } else if (current.length < 6) {
          const entity = this.ha!.getEntity(id)
          saveConfig({
            dashboard: [...current, {
              entity_id: id,
              label: this.friendlyName(id),
              unit: this.guessUnit(entity),
            }],
          })
        }
        this.render()
      })
    })
  }

  private getControllableEntities() {
    if (!this.ha) return []
    const result: { entity_id: string; state: string; attributes: Record<string, unknown> }[] = []
    for (const domain of CONTROLLABLE_DOMAINS) {
      result.push(...this.ha.getEntitiesByDomain(domain))
    }
    return result
  }

  private getSensorEntities() {
    if (!this.ha) return []
    const result: { entity_id: string; state: string; attributes: Record<string, unknown> }[] = []
    for (const domain of SENSOR_DOMAINS) {
      result.push(...this.ha.getEntitiesByDomain(domain))
    }
    return result
  }

  private getHARooms(): Record<string, string[]> {
    if (!this.ha) return {}
    const rooms: Record<string, string[]> = {}
    const entities = this.getControllableEntities()
    for (const e of entities) {
      const area = this.ha.getEntityArea(e.entity_id)
      if (area) {
        if (!rooms[area]) rooms[area] = []
        rooms[area].push(e.entity_id)
      }
    }
    return rooms
  }

  private friendlyName(entityId: string): string {
    const entity = this.ha?.getEntity(entityId)
    if (entity?.attributes?.friendly_name) {
      return entity.attributes.friendly_name as string
    }
    return entityId.split('.')[1].replace(/_/g, ' ')
  }

  private guessUnit(entity: { attributes: Record<string, unknown> } | undefined | null): string {
    if (!entity) return ''
    const unit = entity.attributes.unit_of_measurement as string | undefined
    return unit ?? ''
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}
