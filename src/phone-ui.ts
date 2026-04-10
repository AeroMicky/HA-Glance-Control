import { HAClient } from './ha-client'
import { getConfig, saveConfig, loadConfig } from './store'
import type { AppConfig, FavoriteConfig, DashboardSlot, EnergySlot } from './store'

const CONTROLLABLE_DOMAINS = ['light', 'switch', 'fan', 'cover', 'climate', 'scene', 'script', 'input_boolean']
const SENSOR_DOMAINS = [
  'sensor', 'binary_sensor',
  'cover', 'lock', 'alarm_control_panel',
  'climate', 'weather', 'device_tracker',
  'input_boolean', 'input_number', 'input_select',
  'switch', 'light',
]

const DOMAIN_ICONS: Record<string, string> = {
  light: '\u{1F4A1}',
  switch: '\u{1F50C}',
  fan: '\u{1F32C}',
  cover: '\u{1F6AA}',
  scene: '\u{1F3AC}',
  script: '\u{2699}',
  input_boolean: '\u{1F518}',
  sensor: '\u{1F4CA}',
  binary_sensor: '\u{1F534}',
  climate: '\u{1F321}',
  lock: '\u{1F512}',
}

type Tab = 'connection' | 'favorites' | 'rooms' | 'sensors'

export class PhoneUI {
  private ha: HAClient | null = null
  private root: HTMLElement
  private tab: Tab = 'connection'
  private onConnect: (ha: HAClient) => void
  private connectError: string | null = null

  constructor(root: HTMLElement, onConnect: (ha: HAClient) => void) {
    this.root = root
    this.onConnect = onConnect
    this.applyTheme()
    loadConfig().then(() => this.render())
  }

  setConnectError(msg: string) {
    this.connectError = msg
    this.tab = 'connection'
  }

  render() {
    const config = getConfig()
    const connected = this.ha !== null

    this.root.innerHTML = `
      <div class="app">
        <header>
          <h1>HA Glance & Control <small>v${__APP_VERSION__}</small></h1>
          <span class="status ${connected ? 'on' : 'off'}">${connected ? 'Connected' : 'Disconnected'}</span>
        </header>
        <nav>
          ${this.tabBtn('connection', 'Setup')}
          ${this.tabBtn('favorites', 'Favs')}
          ${this.tabBtn('rooms', 'Rooms')}
          ${this.tabBtn('sensors', 'Sensors')}
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
      case 'sensors': this.renderSensors(content, config); break
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
    const hasCredentials = config.ha_url && config.ha_token
    el.innerHTML = `
      <section>
        <p class="section-header">App Settings</p>
        <div class="card">
          <div class="entity-row" id="dark-mode-toggle">
            <div class="row-text"><span class="name">Dark Mode</span></div>
            <div class="row-right"><span class="checkbox ${this.isDarkMode() ? 'checked' : ''}">&#10003;</span></div>
          </div>
        </div>
      </section>

      <section>
        <p class="section-header">Glasses Display</p>

        <label>Clock</label>
        <div class="card">
          <div class="entity-row" id="clock-toggle">
            <div class="row-text"><span class="name">Show Clock</span></div>
            <div class="row-right"><span class="checkbox ${config.clock?.show !== false ? 'checked' : ''}">&#10003;</span></div>
          </div>
          <div class="entity-row" id="clock-format">
            <div class="row-text"><span class="name">Format: ${config.clock?.format === '12h' ? '12-hour' : '24-hour'}</span></div>
            <div class="row-right"><span class="chevron">&#x203A;</span></div>
          </div>
        </div>

        <label>Status Panel Sort</label>
        <div class="card">
          <div class="entity-list" id="status-sort-options">
            ${(['status', 'name', 'custom', 'recent'] as const).map(mode => {
              const labels: Record<string, string> = { status: 'By Status', name: 'By Name', custom: 'Custom Order', recent: 'Recently Used' }
              const descs: Record<string, string> = { status: 'Active entities first', name: 'Alphabetical', custom: 'Manual room order', recent: 'Most recent first' }
              const current = config.statusPanelSort ?? 'status'
              return `
              <div class="entity-row status-sort-option" data-sort-mode="${mode}">
                <div class="row-text">
                  <span class="name">${labels[mode]}</span>
                  <span class="subtitle">${descs[mode]}</span>
                </div>
                <div class="row-right"><span class="checkbox ${current === mode ? 'checked' : ''}">&#10003;</span></div>
              </div>
            `}).join('')}
          </div>
        </div>
      </section>

      <section>
        <label>After Action</label>
        <div class="card">
          <div class="entity-list" id="post-action-options">
            ${(['back', 'home', 'standby'] as const).map(mode => {
              const labels: Record<string, string> = { back: 'Go Back', home: 'Main Menu', standby: 'Standby' }
              const descs: Record<string, string> = { back: 'Return to previous screen', home: 'Return to home screen', standby: 'Enter standby mode' }
              const current = config.postActionDestination ?? 'back'
              return `
              <div class="entity-row post-action-option" data-mode="${mode}">
                <div class="row-text">
                  <span class="name">${labels[mode]}</span>
                  <span class="subtitle">${descs[mode]}</span>
                </div>
                <div class="row-right"><span class="checkbox ${current === mode ? 'checked' : ''}">&#10003;</span></div>
              </div>
            `}).join('')}
          </div>
        </div>
      </section>

      <section>
        <p class="section-header">Backup & Restore</p>
        <div class="card">
          <div class="entity-row" id="export-config" style="cursor:pointer">
            <div class="row-text"><span class="name">Export Settings</span><span class="subtitle">Saves layout &amp; preferences, not credentials</span></div>
            <div class="row-right"><span class="chevron">&#x2193;</span></div>
          </div>
          <div class="entity-row" id="import-config-row" style="cursor:pointer">
            <div class="row-text"><span class="name">Import Settings</span><span class="subtitle">Restore config from JSON file</span></div>
            <div class="row-right"><span class="chevron">&#x2191;</span></div>
          </div>
          <div class="entity-row" id="reset-config" style="cursor:pointer">
            <div class="row-text"><span class="name" style="color:#ff453a">Reset Settings</span><span class="subtitle">Clear all preferences, keep connection</span></div>
            <div class="row-right"><span class="chevron" style="color:#ff453a">&#x26A0;</span></div>
          </div>
        </div>
        <input type="file" id="import-file-input" accept=".json" style="display:none">
        <p id="backup-status" style="font-size:12px;color:var(--accent);margin:4px 0 0 4px;min-height:16px"></p>
      </section>

      <section style="margin-top:24px">
        <div class="card">
          <div class="entity-row" id="connection-toggle" style="cursor:pointer">
            <div class="row-text">
              <span class="name">Connection</span>
              <span class="subtitle">${connected ? 'Connected' : hasCredentials ? 'Configured' : 'Not configured'}</span>
            </div>
            <div class="row-right">
              <span class="status ${connected ? 'on' : 'off'}" style="font-size:12px">${connected ? 'Online' : 'Offline'}</span>
              <span class="chevron" id="connection-chevron">&#x25BC;</span>
            </div>
          </div>
        </div>
        <div id="connection-details" style="display:${hasCredentials && connected ? 'none' : 'block'}">
          <label>HA Server URL</label>
          <input id="ha-url" type="text" placeholder="wss://xxxxx.ui.nabu.casa/api/websocket"
                 value="${this.escHtml(config.ha_url)}" >
          <p class="hint">
            Nabu Casa: <code>wss://xxxxx.ui.nabu.casa/api/websocket</code><br>
            Local: <code>ws://homeassistant.local:8123/api/websocket</code>
          </p>
          <label>Long-Lived Access Token</label>
          <input id="ha-token" type="password" placeholder="Paste token from HA Profile"
                 value="${this.escHtml(config.ha_token)}" >
          <p class="hint">
            Profile &rarr; Security &rarr; Long-Lived Access Tokens &rarr; Create Token
          </p>
          <button id="connect-btn" class="primary">${connected ? 'Reconnect' : 'Connect'}</button>
          <p id="connect-status">${this.connectError ? `Failed: ${this.escHtml(this.connectError)}` : ''}</p>
        </div>
      </section>
    `

    // Toggle connection details visibility
    el.querySelector('#connection-toggle')?.addEventListener('click', () => {
      const details = el.querySelector('#connection-details') as HTMLElement
      const chevron = el.querySelector('#connection-chevron') as HTMLElement
      if (details.style.display === 'none') {
        details.style.display = 'block'
        chevron.innerHTML = '&#x25B2;'
      } else {
        details.style.display = 'none'
        chevron.innerHTML = '&#x25BC;'
      }
    })

    el.querySelector('#connect-btn')?.addEventListener('click', () => this.handleConnect(el))

    el.querySelector('#dark-mode-toggle')?.addEventListener('click', () => {
      this.toggleDarkMode()
      this.render()
    })

    el.querySelector('#clock-toggle')?.addEventListener('click', () => {
      const clock = { ...(getConfig().clock ?? { show: true, format: '24h' as const }) }
      clock.show = !clock.show
      saveConfig({ clock })
      this.render()
    })

    el.querySelector('#clock-format')?.addEventListener('click', () => {
      const clock = { ...(getConfig().clock ?? { show: true, format: '24h' as const }) }
      clock.format = clock.format === '24h' ? '12h' : '24h'
      saveConfig({ clock })
      this.render()
    })

    el.querySelectorAll('.status-sort-option').forEach(row => {
      row.addEventListener('click', () => {
        const mode = row.getAttribute('data-sort-mode') as 'status' | 'name' | 'custom' | 'recent'
        saveConfig({ statusPanelSort: mode })
        this.render()
      })
    })

    el.querySelectorAll('.post-action-option').forEach(row => {
      row.addEventListener('click', () => {
        const mode = row.getAttribute('data-mode') as 'back' | 'home' | 'standby'
        saveConfig({ postActionDestination: mode })
        this.render()
      })
    })

    el.querySelector('#export-config')?.addEventListener('click', () => {
      const { ha_url, ha_token, ...cfg } = getConfig()
      const json = JSON.stringify(cfg, null, 2)
      const isAndroid = /android/i.test(navigator.userAgent)

      if (isAndroid) {
        // Android webview supports downloads reliably
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'g2-ha-config.json'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        // Simulator / iOS — show copy modal
        this.showExportModal(json)
      }
    })

    el.querySelector('#import-config-row')?.addEventListener('click', () => {
      ;(el.querySelector('#import-file-input') as HTMLInputElement).click()
    })

    el.querySelector('#reset-config')?.addEventListener('click', () => {
      const status = el.querySelector('#backup-status') as HTMLElement
      if (!confirm('Reset all preferences? This will clear favorites, rooms, sensors, and display settings. Your connection details will be kept.')) return
      const { ha_url, ha_token } = getConfig()
      saveConfig({
        favorites: [],
        rooms: {},
        roomOrder: [],
        roomListSortMode: 'custom',
        roomSortMode: {},
        statusPanelSort: 'status',
        headerSensors: [],
        footerSensors: [],
        clock: { show: true, format: '24h' },
        recentlyUsed: [],
        recentlyUsedRooms: [],
        customNames: {},
        customIcons: {},
        ha_url,
        ha_token,
      })
      status.textContent = 'Settings reset'
      setTimeout(() => this.render(), 800)
    })

    el.querySelector('#import-file-input')?.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      const status = el.querySelector('#backup-status') as HTMLElement
      if (!file) return
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.favorites)) throw new Error('Invalid config file')
        saveConfig(parsed)
        status.textContent = 'Settings restored successfully'
        setTimeout(() => this.render(), 800)
      } catch (err) {
        status.style.color = 'var(--error, #ff453a)'
        status.textContent = err instanceof Error ? err.message : 'Import failed'
      }
    })
  }

  private async handleConnect(el: HTMLElement) {
    const url = (el.querySelector('#ha-url') as HTMLInputElement).value.trim()
    const token = (el.querySelector('#ha-token') as HTMLInputElement).value.trim()
    const status = el.querySelector('#connect-status') as HTMLElement

    if (!url || !token) {
      status.textContent = 'URL and token are required'
      return
    }

    this.connectError = null
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
      el.innerHTML = '<div class="empty-state"><p class="empty-title">Not connected</p><p class="empty-desc">Connect to HA first</p></div>'
      return
    }

    const entities = this.getControllableEntities()
    const favIds = new Set(config.favorites.map(f => f.entity_id))

    el.innerHTML = `
      <p class="section-header">Selected (${config.favorites.length}/8)</p>
      ${config.favorites.length === 0 ? `
        <div class="empty-state">
          <p class="empty-title">No favorites yet</p>
          <p class="empty-desc">Tap any entity below to add it to your glasses</p>
        </div>
      ` : `
        <div class="card">
          <div id="fav-list" class="entity-list">
            ${config.favorites.map((f, i) => {
              const entity = this.ha!.getEntity(f.entity_id)
              const displayName = config.customNames[f.entity_id] || f.label
              const domain = f.entity_id.split('.')[0]
              const state = entity?.state ?? 'unknown'
              const total = config.favorites.length
              return `
              <div class="entity-row" data-id="${f.entity_id}" data-idx="${i}">
                <div class="drag-handle" data-drag-idx="${i}" data-drag-list="fav"><span></span><span></span><span></span></div>
                ${this.domainIconHtml(domain)}
                <div class="row-text">
                  <span class="name">${this.escHtml(displayName)}</span>
                  <span class="subtitle">${this.formatState(state, entity)}</span>
                </div>
                <div class="row-right">
                  <span class="chevron">&#x203A;</span>
                </div>
              </div>
            `}).join('')}
          </div>
        </div>
      `}
      <p class="section-header">Add Entities</p>
      <input class="search-input" id="entity-search" type="text" placeholder="Search by name or entity ID...">
      <div class="card">
        <div id="available-list" class="entity-list">
          ${entities.filter(e => !favIds.has(e.entity_id)).map(e => {
            const domain = e.entity_id.split('.')[0]
            return `
            <div class="entity-row" data-id="${e.entity_id}">
              ${this.domainIconHtml(domain)}
              <div class="row-text">
                <span class="name">${this.escHtml(this.friendlyName(e.entity_id))}</span>
                <span class="subtitle">${e.entity_id}</span>
              </div>
              <div class="row-right">
                <span class="detail">${this.formatState(e.state, e)}</span>
              </div>
            </div>
          `}).join('')}
        </div>
      </div>
    `

    el.querySelector('#entity-search')!.addEventListener('input', (ev) => {
      const q = (ev.target as HTMLInputElement).value.toLowerCase()
      el.querySelectorAll('#available-list .entity-row').forEach(row => {
        const text = row.textContent?.toLowerCase() ?? ''
        ;(row as HTMLElement).style.display = text.includes(q) ? '' : 'none'
      })
    })

    el.querySelectorAll('#available-list .entity-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id')!
        const current = getConfig().favorites
        if (current.length < 8) {
          saveConfig({ favorites: [...current, { entity_id: id, label: this.friendlyName(id) }] })
        }
        this.render()
      })
    })

    // Drag to reorder favorites
    this.bindDragReorder(el, 'fav', (fromIdx, toIdx) => {
      const favorites = [...getConfig().favorites]
      const [moved] = favorites.splice(fromIdx, 1)
      favorites.splice(toIdx, 0, moved)
      saveConfig({ favorites })
      this.render()
    })

    el.querySelectorAll('#fav-list .entity-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) return
        const id = row.getAttribute('data-id')!
        const displayName = config.customNames[id] || config.favorites.find(f => f.entity_id === id)?.label || id
        this.showItemActions(id, displayName, 'favorite')
      })
    })
  }

  private renderRooms(el: HTMLElement, config: AppConfig) {
    if (!this.ha) {
      el.innerHTML = '<div class="empty-state"><p class="empty-title">Not connected</p><p class="empty-desc">Connect to HA first</p></div>'
      return
    }

    const haRooms = this.getHARooms()

    if (Object.keys(haRooms).length === 0) {
      el.innerHTML = '<div class="empty-state"><p class="empty-title">No areas found</p><p class="empty-desc">Assign entities to areas in HA to see them here</p></div>'
      return
    }

    const configuredRooms = config.rooms
    const sortModes = config.roomSortMode ?? {}
    const roomListSortMode = config.roomListSortMode ?? 'custom'
    const sortedRoomEntries = this.sortRoomList(Object.entries(haRooms), config)

    el.innerHTML = `
      <div class="rooms-list-header">
        <p class="hint" style="margin-top:4px;flex:1">Select entities to show on your glasses under each room.</p>
        <div class="sort-toggle" id="room-list-sort">
          <button class="sort-toggle-btn ${roomListSortMode === 'custom' ? 'active' : ''}" data-mode="custom">Custom</button>
          <button class="sort-toggle-btn ${roomListSortMode === 'recent' ? 'active' : ''}" data-mode="recent">Recent</button>
        </div>
      </div>
      ${sortedRoomEntries.map(([room, entityIds], roomIdx) => {
        const included = configuredRooms[room] ?? []
        const includedSet = new Set(included)
        const sortMode = sortModes[room] ?? 'custom'
        const sortedIncluded = sortMode === 'recent'
          ? this.sortByRecent(included)
          : included
        return `
          <div class="room-block">
            <div class="room-header">
              <div class="room-header-left">
                ${roomListSortMode === 'custom' ? `
                  <div class="drag-handle" data-drag-idx="${roomIdx}" data-drag-list="room-order"><span></span><span></span><span></span></div>
                ` : ''}
                <span>${this.escHtml(room)} <span class="count">(${included.length}/${entityIds.length})</span></span>
              </div>
              <div class="room-header-actions">
                <div class="sort-toggle" data-room-sort="${this.escHtml(room)}">
                  <button class="sort-toggle-btn ${sortMode === 'custom' ? 'active' : ''}" data-mode="custom">Custom</button>
                  <button class="sort-toggle-btn ${sortMode === 'recent' ? 'active' : ''}" data-mode="recent">Recent</button>
                </div>
                <button class="select-all-btn" data-room-all="${this.escHtml(room)}">Select All</button>
              </div>
            </div>
            ${sortedIncluded.length > 0 ? `
              <div class="card">
                <div class="entity-list room-selected-list" data-room-list="${this.escHtml(room)}">
                  ${sortedIncluded.map((id, i) => {
                    const entity = this.ha!.getEntity(id)
                    const domain = id.split('.')[0]
                    const displayName = config.customNames[id] || this.friendlyName(id)
                    const state = entity?.state ?? 'unknown'
                    const total = sortedIncluded.length
                    return `
                    <div class="entity-row selected-room-entity" data-room="${this.escHtml(room)}" data-id="${id}" data-idx="${i}">
                      ${sortMode === 'custom' ? `
                        <div class="drag-handle" data-drag-idx="${i}" data-drag-list="room-${this.escHtml(room)}"><span></span><span></span><span></span></div>
                      ` : ''}
                      ${this.domainIconHtml(domain)}
                      <div class="row-text">
                        <span class="name">${this.escHtml(displayName)}</span>
                        <span class="subtitle">${this.formatState(state, entity)}</span>
                      </div>
                      <div class="row-right">
                        <span class="chevron" data-rename-room="${id}" data-current="${this.escHtml(displayName)}">&#x203A;</span>
                      </div>
                    </div>
                  `}).join('')}
                </div>
              </div>
            ` : ''}
            <div class="card">
              <div class="entity-list">
                ${entityIds.filter(id => !includedSet.has(id)).map(id => {
                  const entity = this.ha!.getEntity(id)
                  const domain = id.split('.')[0]
                  const displayName = this.friendlyName(id)
                  const state = entity?.state ?? 'unknown'
                  return `
                  <div class="entity-row" data-room="${this.escHtml(room)}" data-id="${id}" data-selected="false">
                    ${this.domainIconHtml(domain)}
                    <div class="row-text">
                      <span class="name">${this.escHtml(displayName)}</span>
                      <span class="subtitle">${this.formatState(state, entity)}</span>
                    </div>
                    <div class="row-right">
                      <span class="checkbox">&#10003;</span>
                    </div>
                  </div>
                `}).join('')}
              </div>
            </div>
          </div>
        `
      }).join('')}

    `

    // Room list sort toggle
    el.querySelector('#room-list-sort')?.querySelectorAll('.sort-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const mode = (btn as HTMLElement).getAttribute('data-mode') as 'custom' | 'recent'
        saveConfig({ roomListSortMode: mode })
        this.render()
      })
    })

    // Drag to reorder rooms
    this.bindDragReorder(el, 'room-order', (fromIdx, toIdx) => {
      const currentOrder = this.getRoomOrder(config)
      const [moved] = currentOrder.splice(fromIdx, 1)
      currentOrder.splice(toIdx, 0, moved)
      saveConfig({ roomOrder: currentOrder })
      this.render()
    })

    // Per-room entity sort toggle buttons
    el.querySelectorAll('.sort-toggle[data-room-sort]').forEach(toggle => {
      toggle.querySelectorAll('.sort-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation()
          const room = (toggle as HTMLElement).getAttribute('data-room-sort')!
          const mode = (btn as HTMLElement).getAttribute('data-mode') as 'custom' | 'recent'
          const roomSortMode = { ...getConfig().roomSortMode, [room]: mode }
          saveConfig({ roomSortMode })
          this.render()
        })
      })
    })

    // Drag to reorder room entities
    const haRoomsForDrag = haRooms
    for (const [room] of sortedRoomEntries) {
      this.bindDragReorder(el, `room-${room}`, (fromIdx, toIdx) => {
        const rooms = { ...getConfig().rooms }
        const current = [...(rooms[room] ?? [])]
        const [moved] = current.splice(fromIdx, 1)
        current.splice(toIdx, 0, moved)
        rooms[room] = current
        saveConfig({ rooms })
        this.render()
      })
    }

    // Selected room entities: tap for actions (rename/remove)
    el.querySelectorAll('.selected-room-entity').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) return
        const target = e.target as HTMLElement
        if (target.hasAttribute('data-rename-room')) {
          e.stopPropagation()
          const id = target.getAttribute('data-rename-room')!
          const displayName = target.getAttribute('data-current')!
          const room = row.getAttribute('data-room')!
          this.showRoomItemActions(id, displayName, room)
          return
        }
      })
    })

    // Unselected entities: click to add
    el.querySelectorAll('.entity-row[data-room][data-selected="false"]').forEach(row => {
      row.addEventListener('click', () => {
        const room = row.getAttribute('data-room')!
        const id = row.getAttribute('data-id')!
        const rooms = { ...getConfig().rooms }
        rooms[room] = [...(rooms[room] ?? []), id]
        saveConfig({ rooms })
        this.render()
      })
    })

    el.querySelectorAll('.select-all-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const room = btn.getAttribute('data-room-all')!
        const rooms = { ...getConfig().rooms }
        rooms[room] = [...(haRooms[room] ?? [])]
        saveConfig({ rooms })
        this.render()
      })
    })

  }

  private renderSensors(el: HTMLElement, config: AppConfig) {
    if (!this.ha) {
      el.innerHTML = '<div class="empty-state"><p class="empty-title">Not connected</p><p class="empty-desc">Connect to HA first</p></div>'
      return
    }

    const headerSlots = config.headerSensors ?? []
    const footerSlots = config.footerSensors ?? []
    const allSlotIds = new Set([...headerSlots, ...footerSlots].map(s => s.entity_id))
    const sensors = this.getSensorEntities()

    const scrollMode = config.sensorScrollMode ?? 'paginate'
    const paginateInterval = config.sensorPaginateInterval ?? 4

    el.innerHTML = `
      <p class="section-header">Display Mode</p>
      <div class="card">
        <div class="entity-list">
          <div class="entity-row status-sort-option ${scrollMode === 'paginate' ? 'selected' : ''}" data-scroll-mode="paginate">
            <span>Paginate</span>
            <span class="detail">Rotate through groups every few seconds</span>
          </div>
          <div class="entity-row status-sort-option ${scrollMode === 'scroll' ? 'selected' : ''}" data-scroll-mode="scroll">
            <span>Scroll</span>
            <span class="detail">Continuous ticker — all sensors visible</span>
          </div>
        </div>
        <p class="hint" style="margin:8px 12px 4px">${scrollMode === 'paginate'
          ? 'Keep it glanceable — 2 to 3 sensors per bar works best. Too many and pages fly by before you can read them.'
          : 'Scroll shows everything continuously. Great for many sensors, but avoid long labels to keep it readable at a glance.'
        }</p>
        ${scrollMode === 'paginate' ? `
        <div class="entity-row" style="gap:12px">
          <span style="flex:1">Rotate every</span>
          <input id="paginate-interval" type="number" min="1" max="60" step="1"
            value="${paginateInterval}"
            style="width:52px;text-align:center;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input,var(--bg-card));color:var(--text)">
          <span>sec</span>
        </div>` : ''}
      </div>

      <p class="section-header">Header Bar (${headerSlots.length})</p>
      <p class="hint" style="margin-top:0">Shown next to the clock and page title.</p>
      ${this.sensorListHtml(headerSlots, 'header', config)}

      <p class="section-header">Footer Bar (${footerSlots.length})</p>
      <p class="hint" style="margin-top:0">Shown at the bottom.</p>
      ${this.sensorListHtml(footerSlots, 'footer', config)}

      <p class="section-header">Available Sensors</p>
      <input class="search-input" id="sensor-search" type="text" placeholder="Search entities...">
      <div class="card">
        <div id="sensor-list" class="entity-list" style="max-height:300px;overflow-y:auto">
          ${sensors.filter(e => !allSlotIds.has(e.entity_id)).map(e => {
            const domain = e.entity_id.split('.')[0]
            const unit = this.guessUnit(e)
            const value = unit ? `${e.state} ${unit}`.trim() : e.state
            return `
            <div class="entity-row sensor-add" data-id="${e.entity_id}">
              ${this.domainIconHtml(domain)}
              <div class="row-text">
                <span class="name">${this.escHtml(this.friendlyName(e.entity_id))}</span>
                <span class="subtitle">${e.entity_id}</span>
              </div>
              <div class="row-right">
                <span class="detail">${this.escHtml(value)}</span>
              </div>
            </div>
          `}).join('')}
        </div>
      </div>
    `

    // Scroll mode toggle
    el.querySelectorAll('[data-scroll-mode]').forEach(row => {
      row.addEventListener('click', () => {
        const mode = row.getAttribute('data-scroll-mode') as 'paginate' | 'scroll'
        saveConfig({ sensorScrollMode: mode })
        this.render()
      })
    })

    // Paginate interval
    el.querySelector('#paginate-interval')?.addEventListener('change', (ev) => {
      const val = parseInt((ev.target as HTMLInputElement).value)
      if (!isNaN(val) && val >= 1 && val <= 60) {
        saveConfig({ sensorPaginateInterval: val })
      }
    })

    // Search
    el.querySelector('#sensor-search')?.addEventListener('input', (ev) => {
      const q = (ev.target as HTMLInputElement).value.toLowerCase()
      el.querySelectorAll('#sensor-list .entity-row').forEach(row => {
        const text = row.textContent?.toLowerCase() ?? ''
        ;(row as HTMLElement).style.display = text.includes(q) ? '' : 'none'
      })
    })

    // Add sensor — show choice: header or footer
    el.querySelectorAll('.sensor-add').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.getAttribute('data-id')!
        const name = this.friendlyName(id)
        const entity = this.ha!.getEntity(id)
        const unit = this.guessUnit(entity)
        this.showBottomSheet(name, 'Add sensor to:', [
          { label: 'Header Bar', style: 'normal', action: () => {
            const current = [...getConfig().headerSensors]
            current.push({ entity_id: id, label: name, unit })
            saveConfig({ headerSensors: current })
            this.dismissOverlay()
            this.render()
          }},
          { label: 'Footer Bar', style: 'normal', action: () => {
            const current = [...getConfig().footerSensors]
            current.push({ entity_id: id, label: name, unit })
            saveConfig({ footerSensors: current })
            this.dismissOverlay()
            this.render()
          }},
          { label: 'Cancel', style: 'cancel', action: () => this.dismissOverlay() },
        ])
      })
    })

    // Sort buttons
    this.bindSensorSortButtons(el, 'header')
    this.bindSensorSortButtons(el, 'footer')

    // Tap configured sensor for actions
    this.bindSensorActions(el, 'header', config)
    this.bindSensorActions(el, 'footer', config)
  }

  private sensorListHtml(slots: import('./store').SensorSlot[], location: 'header' | 'footer', config: AppConfig): string {
    if (slots.length === 0) {
      return '<div class="empty-state"><p class="empty-desc">Tap a sensor below to add</p></div>'
    }
    return `
      <div class="card">
        <div class="entity-list sensor-list-${location}">
          ${slots.map((s, i) => {
            const entity = this.ha!.getEntity(s.entity_id)
            const state = entity?.state ?? '?'
            const unit = (entity?.attributes?.unit_of_measurement as string) || s.unit || ''
            const tags = s.showBar ? 'Bar' : ''
            const total = slots.length
            return `
            <div class="entity-row sensor-configured" data-location="${location}" data-idx="${i}">
              <div class="drag-handle" data-drag-idx="${i}" data-drag-list="sensor-${location}"><span></span><span></span><span></span></div>
              ${this.domainIconHtml(s.entity_id.split('.')[0])}
              <div class="row-text">
                <span class="name">${s.label === '' ? `<em style="opacity:0.5">${this.escHtml(config.customNames[s.entity_id] || this.friendlyName(s.entity_id))} (label hidden)</em>` : this.escHtml(config.customNames[s.entity_id] || s.label || this.friendlyName(s.entity_id))}</span>
                <span class="subtitle">${this.escHtml(s.entity_id)} · ${this.escHtml(`${state} ${unit}`.trim())}${tags ? ' | ' + tags : ''}${s.condition ? ` | if ${s.condition.operator} ${s.condition.value}` : ''}</span>
              </div>
              <div class="row-right">
                <span class="chevron">&#x203A;</span>
              </div>
            </div>
          `}).join('')}
        </div>
      </div>
    `
  }

  private bindSensorSortButtons(el: HTMLElement, location: 'header' | 'footer') {
    const key = location === 'header' ? 'headerSensors' : 'footerSensors'
    this.bindDragReorder(el, `sensor-${location}`, (fromIdx, toIdx) => {
      const current = [...getConfig()[key]]
      const [moved] = current.splice(fromIdx, 1)
      current.splice(toIdx, 0, moved)
      saveConfig({ [key]: current })
      this.render()
    })
  }

  private bindSensorActions(el: HTMLElement, location: 'header' | 'footer', config: AppConfig) {
    const key = location === 'header' ? 'headerSensors' : 'footerSensors'
    el.querySelectorAll(`.sensor-list-${location} .sensor-configured`).forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) return
        const idx = parseInt(row.getAttribute('data-idx')!)
        const slot = getConfig()[key][idx]
        if (!slot) return
        this.showSensorActions(idx, slot, location)
      })
    })
  }

  private showSensorActions(idx: number, slot: import('./store').SensorSlot, location: 'header' | 'footer') {
    const key = location === 'header' ? 'headerSensors' : 'footerSensors' as const
    const otherKey = location === 'header' ? 'footerSensors' : 'headerSensors' as const
    const otherLabel = location === 'header' ? 'Footer' : 'Header'

    const displayName = getConfig().customNames[slot.entity_id] || slot.label || slot.entity_id
    this.showBottomSheet(
      displayName,
      `${location === 'header' ? 'Header' : 'Footer'} sensor`,
      [
        { label: 'Rename', style: 'normal', action: () => {
          this.dismissOverlay()
          this.showSensorRenameDialog(idx, displayName, key)
        }},
        { label: slot.showBar ? 'Disable Progress Bar' : 'Enable Progress Bar', style: 'normal', action: () => {
          const current = [...getConfig()[key]]
          current[idx] = { ...current[idx], showBar: !current[idx].showBar, showValue: true }
          saveConfig({ [key]: current })
          this.dismissOverlay()
          this.render()
        }},
        ...(slot.showBar ? [{ label: slot.showValue !== false ? 'Hide Value (Bar Only)' : 'Show Value', style: 'normal', action: () => {
          const current = [...getConfig()[key]]
          current[idx] = { ...current[idx], showValue: current[idx].showValue === false ? true : false }
          saveConfig({ [key]: current })
          this.dismissOverlay()
          this.render()
        }}] : []),
        { label: slot.label ? 'Hide Label (Value Only)' : 'Show Label', style: 'normal', action: () => {
          const current = [...getConfig()[key]]
          if (current[idx].label) {
            current[idx] = { ...current[idx], _savedLabel: current[idx].label, label: '' }
          } else {
            current[idx] = { ...current[idx], label: current[idx]._savedLabel || this.friendlyName(current[idx].entity_id) }
          }
          saveConfig({ [key]: current })
          this.dismissOverlay()
          this.render()
        }},
        { label: 'Customize Value', style: 'normal', action: () => {
          this.dismissOverlay()
          this.showSensorValueDialog(idx, slot, key)
        }},
        { label: slot.condition ? 'Edit Condition' : 'Set Condition', style: 'normal', action: () => {
          this.dismissOverlay()
          this.showSensorConditionDialog(idx, slot, key)
        }},
        ...(slot.condition ? [{ label: 'Remove Condition', style: 'delete', action: () => {
          const current = [...getConfig()[key]]
          current[idx] = { ...current[idx], condition: undefined }
          saveConfig({ [key]: current })
          this.dismissOverlay()
          this.render()
        }}] : []),
        { label: `Move to ${otherLabel}`, style: 'normal', action: () => {
          const from = [...getConfig()[key]]
          const to = [...getConfig()[otherKey]]
          const [moved] = from.splice(idx, 1)
          to.push(moved)
          saveConfig({ [key]: from, [otherKey]: to })
          this.dismissOverlay()
          this.render()
        }},
        { label: 'Remove', style: 'delete', action: () => {
          const current = [...getConfig()[key]]
          current.splice(idx, 1)
          saveConfig({ [key]: current })
          this.dismissOverlay()
          this.render()
        }},
        { label: 'Cancel', style: 'cancel', action: () => this.dismissOverlay() },
      ]
    )
  }

  private showSensorRenameDialog(idx: number, currentName: string, key: 'headerSensors' | 'footerSensors') {
    this.dismissOverlay()
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.id = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal-dialog">
        <p class="modal-title">Rename</p>
        <input id="rename-input" type="text" value="${this.escHtml(currentName)}">
        <div class="modal-actions">
          <button class="modal-cancel" id="rename-cancel">Cancel</button>
          <button class="modal-confirm" id="rename-confirm">Confirm</button>
        </div>
      </div>
    `
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.dismissOverlay() })
    document.body.appendChild(overlay)
    const input = overlay.querySelector('#rename-input') as HTMLInputElement
    input.focus(); input.select()
    overlay.querySelector('#rename-cancel')!.addEventListener('click', () => this.dismissOverlay())
    overlay.querySelector('#rename-confirm')!.addEventListener('click', () => {
      const newName = input.value.trim()
      if (newName) {
        const entityId = getConfig()[key][idx].entity_id
        const customNames = { ...getConfig().customNames, [entityId]: newName }
        saveConfig({ customNames })
        this.dismissOverlay()
        this.render()
      }
    })
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') overlay.querySelector<HTMLButtonElement>('#rename-confirm')!.click() })
  }

  private showSensorValueDialog(idx: number, slot: import('./store').SensorSlot, key: 'headerSensors' | 'footerSensors') {
    const entity = this.ha?.getEntity(slot.entity_id)
    const isNumeric = entity ? !isNaN(parseFloat(entity.state)) : false
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.id = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal-dialog">
        <p class="modal-title">Customize Value</p>
        ${isNumeric ? `
        <label style="font-size:13px;color:var(--text-secondary)">Divide by (e.g. 1000 for W→kW)</label>
        <input id="divisor-input" type="number" min="0.001" step="any" value="${slot.divisor ?? 1}" style="margin-bottom:12px">
        ` : ''}
        <label style="font-size:13px;color:var(--text-secondary)">Display override</label>
        <input id="unit-input" type="text" value="${slot.unitOverride ?? ''}" placeholder="${isNumeric ? 'e.g. kW' : 'e.g. !'}">
        <p class="hint" style="margin:6px 0 0">${isNumeric
          ? 'Replaces the unit from HA.'
          : 'Replaces the state text. Use <strong>!</strong> to show a compact warning, e.g. <em>Garage !</em> when open.'
        }</p>
        <div class="modal-actions">
          <button class="modal-cancel" id="val-cancel">Cancel</button>
          <button class="modal-confirm" id="val-confirm">Save</button>
        </div>
      </div>
    `
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.dismissOverlay() })
    document.body.appendChild(overlay)
    const divisorInput = overlay.querySelector('#divisor-input') as HTMLInputElement | null
    const unitInput = overlay.querySelector('#unit-input') as HTMLInputElement
    ;(divisorInput ?? unitInput).focus()
    overlay.querySelector('#val-cancel')!.addEventListener('click', () => this.dismissOverlay())
    overlay.querySelector('#val-confirm')!.addEventListener('click', () => {
      const divisor = divisorInput ? parseFloat(divisorInput.value) : NaN
      const unitOverride = unitInput.value.trim() || undefined
      const current = [...getConfig()[key]]
      current[idx] = {
        ...current[idx],
        divisor: isNaN(divisor) || divisor === 1 ? undefined : divisor,
        unitOverride,
      }
      saveConfig({ [key]: current })
      this.dismissOverlay()
      this.render()
    })
  }

  private showSensorConditionDialog(idx: number, slot: import('./store').SensorSlot, key: 'headerSensors' | 'footerSensors') {
    const entity = this.ha?.getEntity(slot.entity_id)
    const currentState = entity?.state ?? ''
    const isNumeric = !isNaN(parseFloat(currentState))
    const current = slot.condition
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.id = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal-dialog">
        <p class="modal-title">Show only when</p>
        <p style="font-size:12px;color:var(--text-secondary);margin:0 0 10px">Current value: <strong>${this.escHtml(currentState)}</strong></p>
        <div id="condition-op-group" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
          ${(isNumeric ? [
            { v: '>',  l: '> above' },
            { v: '>=', l: '>= at or above' },
            { v: '<',  l: '< below' },
            { v: '<=', l: '<= at or below' },
            { v: '==', l: '== equals' },
            { v: '!=', l: '!= not equals' },
          ] : [
            { v: '==', l: '== equals' },
            { v: '!=', l: '!= not equals' },
          ]).map(o => `<button type="button" class="cond-op-btn" data-op="${o.v}"
            style="padding:6px 10px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:13px;
              background:${(current?.operator ?? '>') === o.v ? 'var(--accent,#2563eb)' : 'var(--bg-card)'};
              color:${(current?.operator ?? '>') === o.v ? '#fff' : 'var(--text)'}"
            >${o.l}</button>`).join('')}
        </div>
        <input id="condition-val" type="${isNumeric ? 'number' : 'text'}" step="any"
          value="${this.escHtml(current?.value ?? '')}"
          placeholder="${isNumeric ? 'e.g. 100' : 'e.g. open'}">
        <div class="modal-actions">
          <button class="modal-cancel" id="cond-cancel">Cancel</button>
          <button class="modal-confirm" id="cond-confirm">Save</button>
        </div>
      </div>
    `
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.dismissOverlay() })
    document.body.appendChild(overlay)
    const valInput = overlay.querySelector('#condition-val') as HTMLInputElement
    valInput.focus()
    // Button group toggle
    let selectedOp = current?.operator ?? (isNumeric ? '>' : '==')
    overlay.querySelectorAll('.cond-op-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedOp = btn.getAttribute('data-op') as typeof selectedOp
        overlay.querySelectorAll('.cond-op-btn').forEach(b => {
          (b as HTMLElement).style.background = 'var(--bg-card)';
          (b as HTMLElement).style.color = 'var(--text)'
        })
        ;(btn as HTMLElement).style.background = 'var(--accent,#2563eb)'
        ;(btn as HTMLElement).style.color = '#fff'
      })
    })

    overlay.querySelector('#cond-cancel')!.addEventListener('click', () => this.dismissOverlay())
    overlay.querySelector('#cond-confirm')!.addEventListener('click', () => {
      const operator = selectedOp
      const value = valInput.value.trim()
      if (value === '') { this.dismissOverlay(); return }
      const slots = [...getConfig()[key]]
      slots[idx] = { ...slots[idx], condition: { operator, value } }
      saveConfig({ [key]: slots })
      this.dismissOverlay()
      this.render()
    })
    valInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') overlay.querySelector<HTMLButtonElement>('#cond-confirm')!.click() })
  }

  // --- Modal Dialogs ---

  private showItemActions(entityId: string, currentName: string, type: 'favorite') {
    const actions: { label: string; style: string; action: () => void }[] = [
      { label: 'Rename', style: 'normal', action: () => this.showRenameDialog(entityId, currentName) },
      { label: 'Remove', style: 'delete', action: () => this.showDeleteConfirm(entityId, currentName, type) },
      { label: 'Cancel', style: 'cancel', action: () => this.dismissOverlay() },
    ]
    this.showBottomSheet(
      currentName,
      type === 'favorite' ? 'Favorite entity' : 'Dashboard sensor',
      actions,
    )
  }

  private showRoomItemActions(entityId: string, currentName: string, room: string) {
    this.showBottomSheet(
      currentName,
      `Entity in ${room}`,
      [
        { label: 'Rename', style: 'normal', action: () => this.showRenameDialog(entityId, currentName) },
        { label: 'Remove from Room', style: 'delete', action: () => {
          const rooms = { ...getConfig().rooms }
          const current = rooms[room] ?? []
          rooms[room] = current.filter(x => x !== entityId)
          if (rooms[room].length === 0) delete rooms[room]
          saveConfig({ rooms })
          this.dismissOverlay()
          this.render()
        }},
        { label: 'Cancel', style: 'cancel', action: () => this.dismissOverlay() },
      ]
    )
  }

  private showExportModal(json: string) {
    this.dismissOverlay()
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.id = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal-dialog" style="width:90%;max-width:480px">
        <p class="modal-title">Export Settings</p>
        <p style="font-size:12px;opacity:0.6;margin:0 0 8px">Copy this JSON and save it as a .json file</p>
        <textarea id="export-json" readonly style="width:100%;height:180px;font-size:11px;font-family:monospace;resize:none;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid var(--border);background:var(--card-bg);color:var(--text)">${this.escHtml(json)}</textarea>
        <p id="export-copy-status" style="font-size:12px;color:var(--accent);min-height:16px;margin:4px 0"></p>
        <div class="modal-actions">
          <button class="modal-cancel" id="export-close">Close</button>
          <button class="modal-confirm" id="export-copy">Copy</button>
        </div>
      </div>
    `
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.dismissOverlay() })
    document.body.appendChild(overlay)

    const textarea = overlay.querySelector('#export-json') as HTMLTextAreaElement
    textarea.focus()
    textarea.select()

    overlay.querySelector('#export-close')!.addEventListener('click', () => this.dismissOverlay())
    overlay.querySelector('#export-copy')!.addEventListener('click', async () => {
      const status = overlay.querySelector('#export-copy-status') as HTMLElement
      try {
        await navigator.clipboard.writeText(json)
        status.textContent = 'Copied to clipboard'
      } catch {
        textarea.select()
        status.textContent = 'Select all + copy manually (Ctrl+A, Ctrl+C)'
      }
    })
  }

  private showBottomSheet(title: string, desc: string, actions: { label: string; style: string; action: () => void }[]) {
    this.dismissOverlay()
    const overlay = document.createElement('div')
    overlay.className = 'bottom-sheet-overlay'
    overlay.id = 'modal-overlay'

    overlay.innerHTML = `
      <div class="bottom-sheet">
        <p class="sheet-title">${this.escHtml(title)}</p>
        <p class="sheet-desc">${this.escHtml(desc)}</p>
        <div class="sheet-actions">
          ${actions.map((a, i) => `<button class="sheet-${a.style}" data-action="${i}">${a.label}</button>`).join('')}
        </div>
      </div>
    `

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismissOverlay()
    })

    actions.forEach((a, i) => {
      overlay.querySelector(`[data-action="${i}"]`)!.addEventListener('click', a.action)
    })

    document.body.appendChild(overlay)
  }

  private showRenameDialog(entityId: string, currentName: string) {
    this.dismissOverlay()
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.id = 'modal-overlay'

    overlay.innerHTML = `
      <div class="modal-dialog">
        <p class="modal-title">Rename</p>
        <input id="rename-input" type="text" value="${this.escHtml(currentName)}">
        <div class="modal-actions">
          <button class="modal-cancel" id="rename-cancel">Cancel</button>
          <button class="modal-confirm" id="rename-confirm">Confirm</button>
        </div>
      </div>
    `

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismissOverlay()
    })

    document.body.appendChild(overlay)

    const input = overlay.querySelector('#rename-input') as HTMLInputElement
    input.focus()
    input.select()

    overlay.querySelector('#rename-cancel')!.addEventListener('click', () => this.dismissOverlay())
    overlay.querySelector('#rename-confirm')!.addEventListener('click', () => {
      const newName = input.value.trim()
      if (newName) {
        const customNames = { ...getConfig().customNames, [entityId]: newName }
        saveConfig({ customNames })
        this.dismissOverlay()
        this.render()
      }
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        overlay.querySelector<HTMLButtonElement>('#rename-confirm')!.click()
      }
    })
  }

  private showDeleteConfirm(entityId: string, name: string, type: 'favorite' | 'dashboard') {
    this.dismissOverlay()
    const typeLabel = type === 'favorite' ? 'favorite' : 'dashboard sensor'

    this.showBottomSheet(
      `Remove ${name}?`,
      `This will remove it from your ${typeLabel}s`,
      [
        { label: 'Remove', style: 'delete', action: () => {
          if (type === 'favorite') {
            const current = getConfig().favorites
            saveConfig({ favorites: current.filter(f => f.entity_id !== entityId) })
          } else {
            const current = getConfig().dashboard
            saveConfig({ dashboard: current.filter(s => s.entity_id !== entityId) })
          }
          this.dismissOverlay()
          this.render()
        }},
        { label: 'Cancel', style: 'cancel', action: () => this.dismissOverlay() },
      ]
    )
  }

  private dismissOverlay() {
    document.getElementById('modal-overlay')?.remove()
  }

  // --- Helpers ---

  private domainIconHtml(domain: string): string {
    const icon = DOMAIN_ICONS[domain] ?? '\u{1F4AC}'
    const cls = domain in DOMAIN_ICONS ? domain : 'default'
    return `<div class="domain-icon ${cls}">${icon}</div>`
  }

  private formatState(state: string, entity: { attributes: Record<string, unknown> } | undefined | null): string {
    if (!state || state === 'unknown' || state === 'unavailable') return state
    const unit = entity?.attributes?.unit_of_measurement as string | undefined
    if (unit) {
      const num = parseFloat(state)
      if (!isNaN(num)) {
        const rounded = Number(num.toFixed(1))
        return `${rounded} ${unit}`
      }
    }
    return state.charAt(0).toUpperCase() + state.slice(1)
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

  private sortRoomList(entries: [string, string[]][], config: AppConfig): [string, string[]][] {
    const mode = config.roomListSortMode ?? 'custom'
    if (mode === 'recent') {
      const recent = config.recentlyUsedRooms ?? []
      if (recent.length === 0) return entries
      return [...entries].sort((a, b) => {
        const ai = recent.indexOf(a[0]), bi = recent.indexOf(b[0])
        if (ai === -1 && bi === -1) return a[0].localeCompare(b[0])
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    }
    // Custom mode: sort by roomOrder
    const order = config.roomOrder ?? []
    if (order.length === 0) return entries
    return [...entries].sort((a, b) => {
      const ai = order.indexOf(a[0]), bi = order.indexOf(b[0])
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }

  private getRoomOrder(config: AppConfig): string[] {
    const haRooms = this.getHARooms()
    const haNames = Object.keys(haRooms)
    const existing = config.roomOrder ?? []
    // Start with existing order, then append any new rooms
    const ordered = existing.filter(n => haNames.includes(n))
    for (const name of haNames) {
      if (!ordered.includes(name)) ordered.push(name)
    }
    return ordered
  }

  private sortByRecent(entityIds: string[]): string[] {
    const recent = getConfig().recentlyUsed
    if (recent.length === 0) return entityIds
    return [...entityIds].sort((a, b) => {
      const ai = recent.indexOf(a), bi = recent.indexOf(b)
      if (ai === -1 && bi === -1) {
        return this.friendlyName(a).localeCompare(this.friendlyName(b))
      }
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
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
    const custom = getConfig().customNames[entityId]
    if (custom) return custom
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

  private bindDragReorder(container: HTMLElement, listName: string, onReorder: (fromIdx: number, toIdx: number) => void) {
    const handles = container.querySelectorAll<HTMLElement>(`.drag-handle[data-drag-list="${listName}"]`)
    let dragIdx = -1

    const getRowAtY = (clientY: number): HTMLElement | null => {
      const rows = container.querySelectorAll<HTMLElement>(`.drag-handle[data-drag-list="${listName}"]`)
      for (const h of rows) {
        const row = h.closest('.entity-row') as HTMLElement
        if (!row) continue
        const rect = row.getBoundingClientRect()
        if (clientY >= rect.top && clientY < rect.bottom) return row
      }
      return null
    }

    const updateDragOver = (clientY: number) => {
      const rows = container.querySelectorAll<HTMLElement>(`.drag-handle[data-drag-list="${listName}"]`)
      rows.forEach(h => {
        const row = h.closest('.entity-row') as HTMLElement
        if (!row) return
        const rect = row.getBoundingClientRect()
        if (clientY >= rect.top && clientY < rect.bottom) {
          row.classList.add('drag-over')
        } else {
          row.classList.remove('drag-over')
        }
      })
    }

    const commitDrop = () => {
      if (dragIdx < 0) return
      const overRow = container.querySelector('.drag-over')
      if (overRow) {
        const overHandle = overRow.querySelector(`.drag-handle[data-drag-list="${listName}"]`)
        if (overHandle) {
          const toIdx = parseInt(overHandle.getAttribute('data-drag-idx')!)
          if (toIdx !== dragIdx) onReorder(dragIdx, toIdx)
        }
      }
      container.querySelectorAll('.dragging, .drag-over').forEach(el => {
        el.classList.remove('dragging', 'drag-over')
      })
      dragIdx = -1
    }

    handles.forEach(handle => {
      // Touch
      handle.addEventListener('touchstart', (e) => {
        e.preventDefault()
        dragIdx = parseInt(handle.getAttribute('data-drag-idx')!)
        const row = handle.closest('.entity-row') as HTMLElement
        if (row) row.classList.add('dragging')
      }, { passive: false })

      // Mouse
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault()
        dragIdx = parseInt(handle.getAttribute('data-drag-idx')!)
        const row = handle.closest('.entity-row') as HTMLElement
        if (row) row.classList.add('dragging')

        const onMouseMove = (ev: MouseEvent) => updateDragOver(ev.clientY)
        const onMouseUp = () => {
          commitDrop()
          document.removeEventListener('mousemove', onMouseMove)
          document.removeEventListener('mouseup', onMouseUp)
        }
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)
      })
    })

    container.addEventListener('touchmove', (e) => {
      if (dragIdx < 0) return
      updateDragOver(e.touches[0].clientY)
    }, { passive: true })

    container.addEventListener('touchend', commitDrop)
  }

  private isDarkMode(): boolean {
    return localStorage.getItem('ha-dark-mode') !== 'false'
  }

  private toggleDarkMode() {
    const dark = !this.isDarkMode()
    localStorage.setItem('ha-dark-mode', dark ? 'true' : 'false')
    this.applyTheme()
  }

  private applyTheme() {
    document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light')
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}
