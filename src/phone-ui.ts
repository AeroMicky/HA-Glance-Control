import { HAClient } from './ha-client'
import { getConfig, saveConfig, loadConfig } from './store'
import type { AppConfig, FavoriteConfig, DashboardSlot, EnergySlot } from './store'

const CONTROLLABLE_DOMAINS = ['light', 'switch', 'fan', 'cover', 'climate', 'scene', 'script', 'automation', 'input_boolean']
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
  automation: '\u{1F916}',
  input_boolean: '\u{1F518}',
  sensor: '\u{1F4CA}',
  binary_sensor: '\u{1F534}',
  climate: '\u{1F321}',
  lock: '\u{1F512}',
}

type Tab = 'home' | 'connection' | 'favorites' | 'rooms' | 'sensors' | 'todoLists'

export class PhoneUI {
  private ha: HAClient | null = null
  private haConnected = false
  private manuallyDisconnected = false
  private root: HTMLElement
  private tab: Tab = 'home'
  private onConnect: (ha: HAClient) => void
  private connectError: string | null = null
  private control: BroadcastChannel | null

  constructor(
    root: HTMLElement,
    onConnect: (ha: HAClient) => void,
    control: BroadcastChannel | null = null,
  ) {
    this.root = root
    this.onConnect = onConnect
    this.control = control
    this.applyTheme()
    loadConfig().then(() => {
      this.render()
    })
  }

  setConnectError(msg: string) {
    this.connectError = msg
    this.tab = 'connection'
  }

  render() {
    const config = getConfig()
    const connected = this.ha !== null && this.haConnected

    this.root.innerHTML = `
      <div class="app">
        <header>
          <h1>${__APP_NAME__} <small>v${__APP_VERSION__}</small></h1>
          <span class="status ${connected ? 'on' : 'off'}">${connected ? 'Connected' : 'Disconnected'}</span>
        </header>
        <nav>
          ${this.tabBtn('home', 'Home')}
          ${this.tabBtn('todoLists', 'Lists')}
          ${this.tabBtn('favorites', 'Favs')}
          ${this.tabBtn('rooms', 'Rooms')}
          ${this.tabBtn('sensors', 'Sensors')}
          ${this.tabBtn('connection', 'Setup')}
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
      case 'home': this.renderHome(content, config); break
      case 'connection': this.renderConnection(content, config); break
      case 'favorites': this.renderFavorites(content, config); break
      case 'rooms': this.renderRooms(content, config); break
      case 'sensors': this.renderSensors(content, config); break
      case 'todoLists': this.renderTodoListsConfig(content, config); break
    }
  }

  private renderHome(el: HTMLElement, config: AppConfig) {
    const connected = this.ha !== null && this.haConnected
    const hasCredentials = !!(config.ha_url && config.ha_token)
    const sensorCount = (config.headerSensors?.length ?? 0) + (config.footerSensors?.length ?? 0)
    const favCount = config.favorites?.length ?? 0
    const roomCount = Object.keys(config.rooms ?? {}).length
    const listCount = config.enabledTodoLists?.length ?? 0

    // Derive status
    let statusLabel: string
    let statusClass: 'ok' | 'warn' | 'err'
    let statusSub: string
    if (!hasCredentials) {
      statusLabel = 'Needs setup'
      statusClass = 'warn'
      statusSub = 'Add your Home Assistant details to get started.'
    } else if (this.manuallyDisconnected) {
      statusLabel = 'Disconnected'
      statusClass = 'warn'
      statusSub = 'You disconnected manually. Tap Connect in Settings to resume.'
    } else if (!connected) {
      statusLabel = this.connectError ? 'Connection error' : 'Reconnecting…'
      statusClass = 'err'
      statusSub = this.connectError ?? 'Trying to reach Home Assistant.'
    } else {
      statusLabel = 'Active'
      statusClass = 'ok'
      statusSub = 'Your glasses are reading Home Assistant.'
    }

    // Masked host (no protocol, no /api/websocket, no token)
    const maskedHost = this.maskHost(config.ha_url)

    const clockMode = config.clock?.show === false
      ? 'off'
      : (config.clock?.format === '12h' ? '12-hour' : '24-hour')

    const setupCta = !hasCredentials
      ? `<button class="home-cta primary" id="home-go-setup">Get started</button>`
      : `<button class="home-cta" id="home-go-setup">Open settings</button>`

    const infoRows = hasCredentials ? `
      <div class="card home-info">
        <div class="home-info-row">
          <span class="home-info-label">Home Assistant</span>
          <span class="home-info-value">${this.escapeHtml(maskedHost || '—')}</span>
        </div>
        <div class="home-info-row">
          <span class="home-info-label">Sensors</span>
          <span class="home-info-value">${sensorCount}</span>
        </div>
        <div class="home-info-row">
          <span class="home-info-label">Favourites</span>
          <span class="home-info-value">${favCount}</span>
        </div>
        <div class="home-info-row">
          <span class="home-info-label">Rooms</span>
          <span class="home-info-value">${roomCount}</span>
        </div>
        <div class="home-info-row">
          <span class="home-info-label">Lists</span>
          <span class="home-info-value">${listCount}</span>
        </div>
        <div class="home-info-row">
          <span class="home-info-label">Clock</span>
          <span class="home-info-value">${clockMode}</span>
        </div>
      </div>
    ` : ''

    el.innerHTML = `
      <section class="home-hero">
        <div class="home-glyph" aria-hidden="true">
          <svg viewBox="0 0 120 48" width="120" height="48">
            <circle cx="28" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="2.5"/>
            <circle cx="92" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="2.5"/>
            <path d="M44 24 h32" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            <path d="M12 22 l-6 -6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
            <path d="M108 22 l6 -6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </div>
        <h2 class="home-title">HA Glance &amp; Control</h2>
        <div class="home-status-pill ${statusClass}">
          <span class="home-status-dot"></span>${this.escapeHtml(statusLabel)}
        </div>
        <p class="home-subtitle">${this.escapeHtml(statusSub)}</p>
      </section>

      ${infoRows}

      <section class="home-actions">
        ${setupCta}
      </section>

      <p class="home-footnote">Keep Even Hub open on your phone for the glasses plugin to stay connected.</p>
    `

    const cta = el.querySelector('#home-go-setup')
    cta?.addEventListener('click', () => {
      this.tab = 'connection'
      this.render()
    })
  }

  private maskHost(url: string): string {
    if (!url) return ''
    return url
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/api\/websocket\/?$/i, '')
      .replace(/\/+$/, '')
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  setHA(ha: HAClient) {
    this.ha = ha
    this.haConnected = true
    this.manuallyDisconnected = false
    this.connectError = null
    this.render()
  }

  setConnected(connected: boolean) {
    this.haConnected = connected
    if (connected) this.connectError = null
    this.render()
  }

  private tabBtn(id: Tab, label: string): string {
    const cls = this.tab === id ? 'tab active' : 'tab'
    return `<button class="${cls}" data-tab="${id}">${label}</button>`
  }

  private renderConnection(el: HTMLElement, config: AppConfig) {
    const connected = this.ha !== null && this.haConnected
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
          <div class="entity-row" id="clock-date">
            <div class="row-text"><span class="name">Show Date</span></div>
            <div class="row-right"><span class="checkbox ${config.clock?.showDate ? 'checked' : ''}">&#10003;</span></div>
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

        <label>Auto Standby</label>
        <p class="hint" style="margin-top:0">Return glasses to standby after inactivity. Prevents accidental taps. Timer resets on a click or double-click &mdash; the ring's scroll gesture is not reported to the app, so scrolling does not count as activity.</p>
        <div class="card">
          <div class="entity-list" id="auto-standby-options">
            ${([
              { val: 0, label: 'Off', desc: 'Double-click only' },
              { val: 15, label: '15 seconds', desc: 'Quick glance' },
              { val: 30, label: '30 seconds', desc: 'Default' },
              { val: 60, label: '1 minute', desc: 'Balanced' },
              { val: 120, label: '2 minutes', desc: 'Reading or browsing' },
              { val: 300, label: '5 minutes', desc: 'Long-form' },
            ]).map(opt => {
              const current = config.autoStandbySeconds ?? 0
              return `
              <div class="entity-row auto-standby-option" data-secs="${opt.val}">
                <div class="row-text">
                  <span class="name">${opt.label}</span>
                  ${opt.desc ? `<span class="subtitle">${opt.desc}</span>` : ''}
                </div>
                <div class="row-right"><span class="checkbox ${current === opt.val ? 'checked' : ''}">&#10003;</span></div>
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
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="connect-btn" class="primary">${connected ? 'Reconnect' : 'Connect'}</button>
            ${this.ha ? `<button id="disconnect-btn">Disconnect</button>` : ''}
          </div>
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
    el.querySelector('#disconnect-btn')?.addEventListener('click', () => this.handleDisconnect(el))

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

    el.querySelector('#clock-date')?.addEventListener('click', () => {
      const clock = { ...(getConfig().clock ?? { show: true, format: '24h' as const }) }
      clock.showDate = !clock.showDate
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

    el.querySelectorAll('.auto-standby-option').forEach(row => {
      row.addEventListener('click', () => {
        const secs = parseInt(row.getAttribute('data-secs') || '0', 10)
        saveConfig({ autoStandbySeconds: secs })
        this.render()
      })
    })

    el.querySelector('#export-config')?.addEventListener('click', () => {
      const { ha_url, ha_token, ...cfg } = getConfig()
      const json = JSON.stringify(cfg, null, 2)
      this.showExportModal(json)
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
      // Tear down any existing client so we don't leak a dangling socket on Reconnect.
      if (this.ha) {
        try { this.ha.disconnect() } catch { /* ignore */ }
      }
      const ha = new HAClient(url, token)
      await ha.connect()
      this.setHA(ha)
      this.onConnect(ha)
      status.textContent = 'Connected!'
      // Tell sibling contexts (sim) their stale HAClient is no longer valid —
      // they'll reload and re-init from current config. No-op in prod.
      try { this.control?.postMessage('reconnect') } catch { /* ignore */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      status.innerHTML = `Failed: ${this.escHtml(msg)}<br><br><small>Common fixes:<br>
        - URL must start with wss:// (Nabu Casa) or ws:// (local)<br>
        - URL must end with /api/websocket<br>
        - Check browser console (F12) for details</small>`
    }
  }

  private handleDisconnect(el: HTMLElement) {
    const status = el.querySelector('#connect-status') as HTMLElement | null
    if (!this.ha) return
    try { this.ha.disconnect() } catch { /* ignore */ }
    this.ha = null
    this.haConnected = false
    this.manuallyDisconnected = true
    this.connectError = null
    // Cross-tab signal for prototype testing (phone browser + simulator in
    // separate contexts). In prod a single HAClient is shared, so this is a
    // no-op. Using the shared channel means we don't loop back to ourselves.
    try { this.control?.postMessage('disconnect') } catch { /* ignore */ }
    if (status) status.textContent = 'Disconnected.'
    this.render()
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
              <div class="entity-row removable-entity fav-selected" data-id="${f.entity_id}" data-idx="${i}" data-current="${this.escHtml(displayName)}">
                <div class="drag-handle" data-drag-idx="${i}" data-drag-list="fav"><span></span><span></span><span></span></div>
                ${this.domainIconHtml(domain)}
                <div class="row-text">
                  <span class="name">${this.escHtml(displayName)}</span>
                  <span class="subtitle">${this.formatState(state, entity)}</span>
                </div>
                <div class="row-right">
                  <span class="remove-btn" data-remove-fav="${f.entity_id}" aria-label="Remove">&minus;</span>
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
            <div class="entity-row add-row fav-available" data-id="${e.entity_id}">
              ${this.domainIconHtml(domain)}
              <div class="row-text">
                <span class="name">${this.escHtml(this.friendlyName(e.entity_id))}</span>
                <span class="subtitle">${e.entity_id} &middot; ${this.formatState(e.state, e)}</span>
              </div>
              <div class="row-right">
                <span class="add-btn" aria-label="Add"></span>
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
        if (row.classList.contains('is-adding')) return
        const current = getConfig().favorites
        if (current.length >= 8) return  // limit reached — silent no-op (matches existing behaviour)
        row.classList.add('is-adding')
        const id = row.getAttribute('data-id')!
        window.setTimeout(() => {
          const now = getConfig().favorites
          if (now.length < 8) {
            saveConfig({ favorites: [...now, { entity_id: id, label: this.friendlyName(id) }] })
          }
          this.render()
        }, 180)
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
        const target = e.target as HTMLElement
        const id = row.getAttribute('data-id')!
        const displayName = row.getAttribute('data-current') ?? config.customNames[id] ?? config.favorites.find(f => f.entity_id === id)?.label ?? id

        if (target.closest('.remove-btn')) {
          e.stopPropagation()
          if (row.classList.contains('is-removing')) return
          row.classList.add('is-removing')
          window.setTimeout(() => {
            saveConfig({ favorites: getConfig().favorites.filter(f => f.entity_id !== id) })
            this.render()
          }, 180)
          return
        }

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
                    <div class="entity-row selected-room-entity removable-entity" data-room="${this.escHtml(room)}" data-id="${id}" data-idx="${i}" data-current="${this.escHtml(displayName)}">
                      ${sortMode === 'custom' ? `
                        <div class="drag-handle" data-drag-idx="${i}" data-drag-list="room-${this.escHtml(room)}"><span></span><span></span><span></span></div>
                      ` : ''}
                      ${this.domainIconHtml(domain)}
                      <div class="row-text">
                        <span class="name">${this.escHtml(displayName)}</span>
                        <span class="subtitle">${this.formatState(state, entity)}</span>
                      </div>
                      <div class="row-right">
                        <span class="remove-btn" data-remove-room="${id}" aria-label="Remove">&minus;</span>
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
                  <div class="entity-row add-row" data-room="${this.escHtml(room)}" data-id="${id}" data-selected="false">
                    ${this.domainIconHtml(domain)}
                    <div class="row-text">
                      <span class="name">${this.escHtml(displayName)}</span>
                      <span class="subtitle">${this.formatState(state, entity)}</span>
                    </div>
                    <div class="row-right">
                      <span class="add-btn" aria-label="Add">+</span>
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

    // Selected room entities: minus removes directly; row body opens actions menu (rename/remove).
    el.querySelectorAll('.selected-room-entity').forEach(row => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) return
        const target = e.target as HTMLElement
        const room = row.getAttribute('data-room')!
        const id = row.getAttribute('data-id')!
        const displayName = row.getAttribute('data-current') ?? id

        if (target.closest('.remove-btn')) {
          e.stopPropagation()
          if (row.classList.contains('is-removing')) return
          row.classList.add('is-removing')
          window.setTimeout(() => {
            const rooms = { ...getConfig().rooms }
            const current = rooms[room] ?? []
            rooms[room] = current.filter(x => x !== id)
            if (rooms[room].length === 0) delete rooms[room]
            saveConfig({ rooms })
            this.render()
          }, 180)
          return
        }

        // Row body tap → actions menu (Rename / Remove)
        this.showRoomItemActions(id, displayName, room)
      })
    })

    // Unselected entities: click to add (brief confirmation animation, then re-render)
    el.querySelectorAll('.entity-row[data-room][data-selected="false"]').forEach(row => {
      row.addEventListener('click', () => {
        if (row.classList.contains('is-adding')) return
        row.classList.add('is-adding')
        const room = row.getAttribute('data-room')!
        const id = row.getAttribute('data-id')!
        window.setTimeout(() => {
          const rooms = { ...getConfig().rooms }
          rooms[room] = [...(rooms[room] ?? []), id]
          saveConfig({ rooms })
          this.render()
        }, 180)
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
        <div id="sensor-list" class="entity-list" style="max-height:300px;overflow-y:auto;overflow-x:hidden">
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
            const current = getConfig().dashboard ?? []
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

  private renderTodoListsConfig(el: HTMLElement, config: AppConfig) {
    if (!this.ha) {
      el.innerHTML = '<div class="empty-state"><p class="empty-title">Not connected</p><p class="empty-desc">Connect to HA first</p></div>'
      return
    }

    const todoEntities = this.ha.getTodoEntities()
    const enabled = config.enabledTodoLists ?? []

    const enabledEntities = todoEntities.filter(e => enabled.includes(e.entity_id))
    el.innerHTML = `
      <p class="section-header">Lists (${todoEntities.length})</p>
      <p class="hint" style="margin-top:0">Select which lists appear on the glasses.</p>
      ${todoEntities.length === 0 ? `
        <div class="card">
          <p class="empty-title">No to-do lists found</p>
          <p class="empty-desc" style="margin-top:8px">
            To use Lists on your glasses, create a to-do list in Home Assistant first.
            Open HA → Settings → Devices &amp; Services → Helpers → + Create Helper → To-do list.
            Your new list will appear here automatically.
          </p>
        </div>
      ` : `
        <div class="card">
          <div class="entity-list">
            ${todoEntities.map(e => {
              const isEnabled = enabled.includes(e.entity_id)
              const itemCount = parseInt(e.state) || 0
              const friendlyName = (e.attributes?.friendly_name as string) || e.entity_id.split('.').pop() || e.entity_id
              return `
              <div class="entity-row" data-id="${e.entity_id}" style="cursor:pointer;user-select:none">
                <input type="checkbox" ${isEnabled ? 'checked' : ''} style="cursor:pointer">
                <div class="row-text">
                  <span class="name">${this.escHtml(friendlyName)}</span>
                  <span class="subtitle">${e.entity_id}</span>
                </div>
                <div class="row-right">
                  <span class="detail">${itemCount} item${itemCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
            `}).join('')}
          </div>
        </div>
      `}
      ${enabledEntities.length > 0 ? `
        ${enabledEntities.length > 1 ? `
          <p class="section-header" style="margin-top:16px">List</p>
          <div class="custom-select" id="items-list-wrap">
            <button type="button" class="cs-trigger" id="items-list-btn">
              <span class="cs-label">${this.escHtml((enabledEntities[0].attributes?.friendly_name as string) || enabledEntities[0].entity_id.split('.').pop() || enabledEntities[0].entity_id)}</span>
              <span class="cs-chevron">&#9662;</span>
            </button>
            <input type="hidden" id="items-list-input" value="${enabledEntities[0].entity_id}">
            <div class="cs-menu" id="items-list-menu" hidden>
              ${enabledEntities.map(e => {
                const name = (e.attributes?.friendly_name as string) || e.entity_id.split('.').pop() || e.entity_id
                return `<button type="button" class="cs-option" data-value="${e.entity_id}" data-label="${this.escHtml(name)}">${this.escHtml(name)}</button>`
              }).join('')}
            </div>
          </div>
        ` : `<input type="hidden" id="items-list-input" value="${enabledEntities[0].entity_id}">`}
        <p class="section-header" style="margin-top:16px">Items</p>
        <div class="card items-card">
          <button type="button" id="add-item-bar" class="items-addbar">
            <span>Add item</span>
            <span class="items-addbar-plus">+</span>
          </button>
          <div id="items-preview" class="items-preview"></div>
        </div>
      ` : ''}
    `


    el.querySelectorAll('.entity-row[data-id]').forEach(row => {
      const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement
      const entityId = row.getAttribute('data-id')!

      const toggleList = () => {
        const newEnabled = checkbox.checked
          ? [...enabled, entityId]
          : enabled.filter(id => id !== entityId)
        saveConfig({ enabledTodoLists: newEnabled })
        this.render()
      }

      // Click anywhere on the row to toggle
      row.addEventListener('click', (e) => {
        e.preventDefault()
        checkbox.checked = !checkbox.checked
        toggleList()
      })

      // Also handle direct checkbox clicks
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleList()
      })
    })

    // Items list picker (multi-list only)
    const listBtn = el.querySelector('#items-list-btn') as HTMLButtonElement | null
    const listMenu = el.querySelector('#items-list-menu') as HTMLElement | null
    const listLabel = el.querySelector('#items-list-btn .cs-label') as HTMLElement | null
    const listInput = el.querySelector('#items-list-input') as HTMLInputElement | null
    if (listBtn && listMenu && listLabel && listInput) {
      const closeMenu = () => { listMenu.hidden = true; listBtn.classList.remove('cs-open') }
      const openMenu = () => { listMenu.hidden = false; listBtn.classList.add('cs-open') }
      listBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        if (listMenu.hidden) openMenu()
        else closeMenu()
      })
      listMenu.querySelectorAll<HTMLButtonElement>('.cs-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation()
          const v = opt.getAttribute('data-value') || ''
          const lbl = opt.getAttribute('data-label') || ''
          listInput.value = v
          listLabel.textContent = lbl
          listMenu.querySelectorAll('.cs-option').forEach(o => o.classList.remove('cs-selected'))
          opt.classList.add('cs-selected')
          closeMenu()
          this.refreshTodoItemsPreview(v)
        })
      })
      document.addEventListener('click', (e) => {
        if (!listMenu.hidden && !listBtn.contains(e.target as Node) && !listMenu.contains(e.target as Node)) closeMenu()
      })
    }

    // Add item bar — opens modal in add mode
    const addBar = el.querySelector('#add-item-bar') as HTMLButtonElement | null
    if (addBar) {
      addBar.addEventListener('click', () => {
        const currentId = (el.querySelector('#items-list-input') as HTMLInputElement | null)?.value
        if (currentId) this.openItemModal(currentId, null)
      })
    }

    // Initial preview fetch for the pre-selected list
    if (enabledEntities.length > 0) {
      this.refreshTodoItemsPreview(enabledEntities[0].entity_id)
    }
  }

  private formatPreviewDue(due?: string): { label: string; overdue: boolean } {
    if (!due) return { label: '', overdue: false }
    const d = new Date(due)
    if (isNaN(d.getTime())) return { label: '', overdue: false }
    const hasTime = due.includes('T')
    const now = new Date()
    const overdue = hasTime ? d.getTime() < now.getTime() : d < new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000)
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    let label: string
    if (diffDays === 0) label = 'Today'
    else if (diffDays === 1) label = 'Tomorrow'
    else if (diffDays === -1) label = 'Yesterday'
    else if (diffDays > 0 && diffDays < 7) label = d.toLocaleDateString(undefined, { weekday: 'short' })
    else label = `${d.getDate()} ${MONTHS[d.getMonth()]}`
    if (hasTime) {
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      label += ` ${hh}:${mm}`
    }
    return { label, overdue }
  }

  private renderItemRow(item: import('./ha-client').TodoItem): string {
    const due = this.formatPreviewDue(item.due)
    const doneClass = item.done ? ' items-row-done' : ''
    const dueClass = due.overdue ? ' items-due-overdue' : ''
    const descHtml = item.description ? `<div class="items-desc">${this.escHtml(item.description)}</div>` : ''
    const dueHtml = due.label ? `<div class="items-due${dueClass}"><span class="items-due-icon">\u25F7</span>${this.escHtml(due.label)}</div>` : ''
    return `
      <div class="items-row${doneClass}" data-uid="${this.escHtml(item.uid)}">
        <button type="button" class="items-check" data-uid="${this.escHtml(item.uid)}" aria-label="Toggle done">
          ${item.done ? '\u2713' : ''}
        </button>
        <div class="items-body">
          <div class="items-title">${this.escHtml(item.summary)}</div>
          ${descHtml}
          ${dueHtml}
        </div>
      </div>
    `
  }

  private async refreshTodoItemsPreview(entityId: string) {
    const root = document.getElementById('items-preview')
    if (!root || !this.ha) return
    root.innerHTML = `<div class="items-empty">Loading items&hellip;</div>`
    let items: import('./ha-client').TodoItem[]
    try {
      items = await this.ha.getTodoItems(entityId)
    } catch {
      if (document.getElementById('items-preview') !== root) return
      root.innerHTML = `<div class="items-empty items-error">Could not load items</div>`
      return
    }
    if (document.getElementById('items-preview') !== root) return  // tab switched mid-fetch
    if (items.length === 0) {
      root.innerHTML = `<div class="items-empty">No items yet</div>`
      return
    }
    const pending = items.filter(i => !i.done)
    const completed = items.filter(i => i.done)
    const sections: string[] = []
    if (pending.length > 0) {
      sections.push(`<div class="items-section-label">Active</div>`)
      sections.push(...pending.map(i => this.renderItemRow(i)))
    }
    if (completed.length > 0) {
      sections.push(`<div class="items-section-label items-section-completed">Completed (${completed.length})</div>`)
      sections.push(...completed.map(i => this.renderItemRow(i)))
    }
    root.innerHTML = sections.join('')

    // Wire up checkbox clicks (toggle done)
    root.querySelectorAll<HTMLButtonElement>('.items-check').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const uid = btn.getAttribute('data-uid') || ''
        const item = items.find(i => i.uid === uid)
        if (!item || !this.ha) return
        btn.disabled = true
        try {
          const ok = await this.ha.editTodoItem(entityId, uid, { done: !item.done })
          if (ok) this.refreshTodoItemsPreview(entityId)
          else btn.disabled = false
        } catch {
          btn.disabled = false
        }
      })
    })

    // Wire up row clicks (open edit modal)
    root.querySelectorAll<HTMLElement>('.items-row').forEach(row => {
      row.addEventListener('click', () => {
        const uid = row.getAttribute('data-uid') || ''
        const item = items.find(i => i.uid === uid)
        if (item) this.openItemModal(entityId, item)
      })
    })
  }

  private openItemModal(entityId: string, existing: import('./ha-client').TodoItem | null) {
    const isEdit = existing !== null
    const listName = (this.ha?.getEntity(entityId)?.attributes?.friendly_name as string) || entityId.split('.').pop() || entityId

    const overlay = document.createElement('div')
    overlay.className = 'item-modal-overlay'
    overlay.innerHTML = `
      <div class="item-modal-card" role="dialog">
        <div class="item-modal-head">
          <div>
            <div class="item-modal-title">${isEdit ? 'Edit item' : 'Add item'}</div>
            <div class="item-modal-subtitle">${this.escHtml(listName)}</div>
          </div>
          <button type="button" class="item-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="item-modal-body">
          ${isEdit ? `
            <label class="item-modal-done-row">
              <input type="checkbox" id="im-done" ${existing!.done ? 'checked' : ''}>
              <span>Mark as done</span>
            </label>
          ` : ''}
          <label style="margin-top:${isEdit ? '16' : '0'}px">Task name<span style="color:#ff453a"> *</span></label>
          <input id="im-name" type="text" placeholder="What needs doing?" value="${isEdit ? this.escHtml(existing!.summary) : ''}">
          <label>Description</label>
          <textarea id="im-desc" class="add-field" rows="3" placeholder="Optional notes">${isEdit && existing!.description ? this.escHtml(existing!.description) : ''}</textarea>
          <label>Due</label>
          <input id="im-due" type="text" class="add-field" placeholder="Pick a date &amp; time" readonly>
        </div>
        <div class="item-modal-actions">
          ${isEdit ? `<button type="button" class="item-modal-delete">Delete</button>` : ''}
          <div style="flex:1"></div>
          <button type="button" class="item-modal-cancel">Cancel</button>
          <button type="button" class="item-modal-save">${isEdit ? 'Save' : 'Add'}</button>
        </div>
        <p class="item-modal-status hint"></p>
      </div>
    `
    document.body.appendChild(overlay)

    const elName = overlay.querySelector('#im-name') as HTMLInputElement
    const elDesc = overlay.querySelector('#im-desc') as HTMLTextAreaElement
    const elDue = overlay.querySelector('#im-due') as HTMLInputElement
    const elDone = overlay.querySelector('#im-done') as HTMLInputElement | null
    const elStatus = overlay.querySelector('.item-modal-status') as HTMLElement
    const elSave = overlay.querySelector('.item-modal-save') as HTMLButtonElement
    const elCancel = overlay.querySelector('.item-modal-cancel') as HTMLButtonElement
    const elClose = overlay.querySelector('.item-modal-close') as HTMLButtonElement
    const elDelete = overlay.querySelector('.item-modal-delete') as HTMLButtonElement | null

    // Due state
    const pad2 = (n: number) => String(n).padStart(2, '0')
    const fmtDisplay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    const toISO = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`
    let dueDate: Date | null = null
    let dueCleared = false
    if (isEdit && existing!.due) {
      const parsed = new Date(existing!.due)
      if (!isNaN(parsed.getTime())) {
        dueDate = parsed
        elDue.value = fmtDisplay(parsed)
      }
    }
    elDue.addEventListener('click', () => {
      this.openDatePicker(dueDate, (picked) => {
        dueDate = picked
        dueCleared = picked === null
        elDue.value = picked ? fmtDisplay(picked) : ''
      })
    })

    const close = () => overlay.remove()
    elClose.addEventListener('click', close)
    elCancel.addEventListener('click', close)
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

    const setBusy = (busy: boolean) => {
      elSave.disabled = busy
      if (elDelete) elDelete.disabled = busy
    }

    elSave.addEventListener('click', async () => {
      const summary = elName.value.trim()
      if (!summary) {
        elName.focus()
        elStatus.textContent = 'Task name required'
        return
      }
      if (!this.ha) return
      const description = elDesc.value.trim()
      setBusy(true)
      elStatus.textContent = isEdit ? 'Saving...' : 'Adding...'
      try {
        if (isEdit) {
          const updates: { rename?: string; description?: string; due?: string | null; done?: boolean } = {}
          if (summary !== existing!.summary) updates.rename = summary
          if (description !== (existing!.description ?? '')) updates.description = description
          if (elDone && elDone.checked !== existing!.done) updates.done = elDone.checked
          if (dueCleared) updates.due = ''
          else if (dueDate) {
            const iso = toISO(dueDate)
            if (iso !== existing!.due) updates.due = iso
          }
          const ok = Object.keys(updates).length === 0
            ? true
            : await this.ha.editTodoItem(entityId, existing!.uid, updates)
          if (ok) {
            close()
            this.refreshTodoItemsPreview(entityId)
          } else {
            elStatus.textContent = 'Save failed'
            setBusy(false)
          }
        } else {
          const due = dueDate ? toISO(dueDate) : undefined
          const ok = await this.ha.addTodoItem(entityId, summary, description || undefined, due)
          if (ok) {
            close()
            this.refreshTodoItemsPreview(entityId)
          } else {
            elStatus.textContent = 'Add failed'
            setBusy(false)
          }
        }
      } catch (err) {
        elStatus.textContent = err instanceof Error ? err.message : 'Error'
        setBusy(false)
      }
    })

    if (elDelete && isEdit) {
      elDelete.addEventListener('click', async () => {
        if (!this.ha) return
        if (!confirm(`Delete "${existing!.summary}"?`)) return
        setBusy(true)
        elStatus.textContent = 'Deleting...'
        try {
          const ok = await this.ha.removeTodoItem(entityId, existing!.uid)
          if (ok) {
            close()
            this.refreshTodoItemsPreview(entityId)
          } else {
            elStatus.textContent = 'Delete failed'
            setBusy(false)
          }
        } catch (err) {
          elStatus.textContent = err instanceof Error ? err.message : 'Error'
          setBusy(false)
        }
      })
    }

    elName.focus()
    if (isEdit) elName.select()
  }

  private openDatePicker(initial: Date | null, onConfirm: (d: Date | null) => void) {
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const WEEKDAYS = ['M','T','W','T','F','S','S']  // Monday-first

    let selected: Date | null = initial ? new Date(initial) : null
    let viewMonth = new Date(selected ?? new Date())
    viewMonth.setDate(1)
    viewMonth.setHours(0, 0, 0, 0)
    let hour = selected ? selected.getHours() : new Date().getHours()
    let minute = selected ? selected.getMinutes() : 0

    const overlay = document.createElement('div')
    overlay.className = 'dp-overlay'
    overlay.innerHTML = `
      <div class="dp-card" role="dialog">
        <div class="dp-header">
          <div class="dp-year"></div>
          <div class="dp-title"></div>
        </div>
        <div class="dp-month-nav">
          <button class="dp-prev" aria-label="Previous month">&lsaquo;</button>
          <div class="dp-month"></div>
          <button class="dp-next" aria-label="Next month">&rsaquo;</button>
        </div>
        <div class="dp-weekdays">
          ${WEEKDAYS.map(d => `<div class="dp-wd">${d}</div>`).join('')}
        </div>
        <div class="dp-grid"></div>
        <div class="dp-time-row">
          <span class="dp-time-label">Time</span>
          <input class="dp-hh" type="number" min="0" max="23" inputmode="numeric">
          <span class="dp-time-sep">:</span>
          <input class="dp-mm" type="number" min="0" max="59" inputmode="numeric">
        </div>
        <div class="dp-actions">
          <button class="dp-clear">Clear</button>
          <button class="dp-today">Today</button>
          <div style="flex:1"></div>
          <button class="dp-cancel">Cancel</button>
          <button class="dp-ok">OK</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const elHeader = overlay.querySelector('.dp-title') as HTMLElement
    const elYear = overlay.querySelector('.dp-year') as HTMLElement
    const elMonth = overlay.querySelector('.dp-month') as HTMLElement
    const elGrid = overlay.querySelector('.dp-grid') as HTMLElement
    const elHH = overlay.querySelector('.dp-hh') as HTMLInputElement
    const elMM = overlay.querySelector('.dp-mm') as HTMLInputElement
    const pad = (n: number) => String(n).padStart(2, '0')

    const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

    const render = () => {
      elYear.textContent = String(selected ? selected.getFullYear() : viewMonth.getFullYear())
      if (selected) {
        elHeader.textContent = `${DAYS_SHORT[selected.getDay()]} ${selected.getDate()} ${MONTHS_SHORT[selected.getMonth()]}`
      } else {
        elHeader.textContent = 'Select date'
      }
      elMonth.textContent = `${MONTHS[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`
      elHH.value = pad(hour)
      elMM.value = pad(minute)

      const firstDay = new Date(viewMonth)
      const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate()
      // JS: Sunday=0, we want Monday-first; leading = (getDay() + 6) % 7
      const leading = (firstDay.getDay() + 6) % 7
      const today = new Date()

      const cells: string[] = []
      for (let i = 0; i < leading; i++) cells.push(`<div class="dp-cell dp-empty"></div>`)
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d)
        const isSelected = selected && sameDay(date, selected)
        const isToday = sameDay(date, today)
        const classes = ['dp-cell']
        if (isSelected) classes.push('dp-selected')
        else if (isToday) classes.push('dp-today-cell')
        cells.push(`<button class="${classes.join(' ')}" data-d="${d}">${d}</button>`)
      }
      elGrid.innerHTML = cells.join('')

      elGrid.querySelectorAll<HTMLButtonElement>('button.dp-cell').forEach(btn => {
        btn.addEventListener('click', () => {
          const d = parseInt(btn.getAttribute('data-d') || '0', 10)
          selected = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d, hour, minute)
          render()
        })
      })
    }

    ;(overlay.querySelector('.dp-prev') as HTMLButtonElement).addEventListener('click', () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1)
      render()
    })
    ;(overlay.querySelector('.dp-next') as HTMLButtonElement).addEventListener('click', () => {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1)
      render()
    })
    ;(overlay.querySelector('.dp-today') as HTMLButtonElement).addEventListener('click', () => {
      const now = new Date()
      selected = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
      viewMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      render()
    })
    ;(overlay.querySelector('.dp-clear') as HTMLButtonElement).addEventListener('click', () => {
      selected = null
      render()
    })
    ;(overlay.querySelector('.dp-cancel') as HTMLButtonElement).addEventListener('click', () => {
      overlay.remove()
    })
    ;(overlay.querySelector('.dp-ok') as HTMLButtonElement).addEventListener('click', () => {
      if (selected) {
        selected.setHours(hour, minute, 0, 0)
      }
      onConfirm(selected)
      overlay.remove()
    })
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })

    const clampTime = () => {
      const h = Math.max(0, Math.min(23, parseInt(elHH.value || '0', 10) || 0))
      const m = Math.max(0, Math.min(59, parseInt(elMM.value || '0', 10) || 0))
      hour = h
      minute = m
      elHH.value = pad(h)
      elMM.value = pad(m)
      if (selected) selected.setHours(h, m, 0, 0)
    }
    elHH.addEventListener('change', clampTime)
    elMM.addEventListener('change', clampTime)

    render()
  }

  private applyTheme() {
    document.body.setAttribute('data-theme', this.isDarkMode() ? 'dark' : 'light')
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}
