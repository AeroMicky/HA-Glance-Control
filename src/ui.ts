import {
  EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { HAClient } from './ha-client'
import { FavoriteConfig, SensorSlot, getConfig, saveConfig } from './store'
import { buildSubItems, defaultServiceCall, SubItem, ServiceCall } from './submenus'

// Layout constants — 576x288 4-bit greyscale display
const W = 576
const H = 288
const HEADER_H = 28
const FOOTER_H = 36
const BODY_TOP = HEADER_H + 4
const BODY_H = H - HEADER_H - FOOTER_H - 12
const LIST_W = 296
const STATUS_X = LIST_W + 8
const STATUS_W = W - STATUS_X

// Separators
const DOT = '  /  '             // separator between sensor values
const ARROW_R = '\u203A'        // › right arrow
const BAR_FULL = '\u2501'       // ━ thick bar segment
const BAR_EMPTY = '\u2500'      // ─ thin bar segment

function resolveEventType(event: EvenHubEvent): OsEventTypeList | undefined {
  const raw =
    event.listEvent?.eventType ??
    event.textEvent?.eventType ??
    event.sysEvent?.eventType
  if (typeof raw === 'number' && raw >= 0 && raw <= 3) return raw as OsEventTypeList
  if (typeof raw === 'string') {
    const v = (raw as string).toUpperCase()
    if (v.includes('DOUBLE')) return OsEventTypeList.DOUBLE_CLICK_EVENT
    if (v.includes('CLICK')) return OsEventTypeList.CLICK_EVENT
    if (v.includes('SCROLL_TOP') || v.includes('UP')) return OsEventTypeList.SCROLL_TOP_EVENT
    if (v.includes('SCROLL_BOTTOM') || v.includes('DOWN')) return OsEventTypeList.SCROLL_BOTTOM_EVENT
  }
  if (event.listEvent || event.textEvent || event.sysEvent) {
    return OsEventTypeList.CLICK_EVENT
  }
  return undefined
}

function domainIcon(domain: string, state: string): string {
  const on = state === 'on' || state === 'open' || state === 'unlocked' || state === 'playing' || state === 'home'
  if (domain === 'scene' || domain === 'script') return '\u25B6'
  return on ? '\u25CF' : '\u25CB'
}

export class UI {
  private bridge: EvenAppBridge
  private ha: HAClient
  private screenStack: Screen[] = [{ type: 'home' }]
  private startupRendered = false
  private rendering = false
  private resultTimer: ReturnType<typeof setTimeout> | null = null
  private favorites: FavoriteConfig[] = []
  private headerSensors: SensorSlot[] = []
  private footerSensors: SensorSlot[] = []
  private rooms = new Map<string, string[]>()
  private roomOrder: string[] = []
  private sortedRoomNames: string[] = []
  private roomListSortMode: 'custom' | 'recent' = 'custom'
  private roomSortMode = new Map<string, 'custom' | 'recent'>()
  private enabledTodoLists: string[] = []
  private connected = true
  private standbyMode = false
  private autoStandbySeconds = 0
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private stateDebounce: ReturnType<typeof setTimeout> | null = null
  private footerPage = 0
  private footerTimer: ReturnType<typeof setInterval> | null = null
  private headerPage = 0
  private headerTimer: ReturnType<typeof setInterval> | null = null
  private headerScrollOffset = 0
  private footerScrollOffset = 0
  private scrollTimer: ReturnType<typeof setInterval> | null = null
  private lastHeaderContent = ''
  private lastFooterContent = ''
  private statusPage = 0
  private statusTimer: ReturnType<typeof setInterval> | null = null

  private get screen(): Screen {
    return this.screenStack[this.screenStack.length - 1]
  }

  private push(screen: Screen) {
    this.screenStack.push(screen)
  }

  constructor(ha: HAClient, bridge: EvenAppBridge) {
    this.ha = ha
    this.bridge = bridge
  }

  configure(opts: {
    favorites: FavoriteConfig[]
    headerSensors: SensorSlot[]
    footerSensors: SensorSlot[]
    rooms: Record<string, string[]>
    roomOrder?: string[]
    roomListSortMode?: 'custom' | 'recent'
    roomSortMode?: Record<string, 'custom' | 'recent'>
    enabledTodoLists?: string[]
    autoStandbySeconds?: number
  }) {
    this.favorites = opts.favorites
    this.headerSensors = opts.headerSensors
    this.footerSensors = opts.footerSensors
    this.rooms.clear()
    for (const [name, ids] of Object.entries(opts.rooms)) {
      this.rooms.set(name, ids)
    }
    this.roomOrder = opts.roomOrder ?? []
    this.roomListSortMode = opts.roomListSortMode ?? 'custom'
    this.roomSortMode.clear()
    if (opts.roomSortMode) {
      for (const [name, mode] of Object.entries(opts.roomSortMode)) {
        this.roomSortMode.set(name, mode)
      }
    }
    this.enabledTodoLists = opts.enabledTodoLists ?? []
    this.autoStandbySeconds = opts.autoStandbySeconds ?? 0
    this.restartIdleTimer()
    // Re-render to reflect config changes
    if (this.startupRendered) {
      this.footerPage = 0
      this.headerPage = 0
      this.headerScrollOffset = 0
      this.footerScrollOffset = 0
      this.lastHeaderContent = ''
      this.lastFooterContent = ''
      this.startPaginateTimers()
      this.render().catch(console.error)
    }
  }

  private startPaginateTimers() {
    if (this.footerTimer) clearInterval(this.footerTimer)
    if (this.headerTimer) clearInterval(this.headerTimer)
    const ms = (getConfig().sensorPaginateInterval ?? 4) * 1000

    this.footerTimer = setInterval(() => {
      if (this.rendering) return
      if (this.standbyMode) return
      if (!this.isChromeScreen()) return
      if (getConfig().sensorScrollMode === 'scroll') return
      const pages = this.footerPages()
      if (pages.length > 1) {
        this.footerPage = (this.footerPage + 1) % pages.length
        this.bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 3,
          containerName: 'footer',
          content: this.footerContent(),
        })).catch(console.error)
      }
    }, ms)

    this.headerTimer = setInterval(() => {
      if (this.rendering) return
      if (getConfig().sensorScrollMode === 'scroll') return
      const title = this.standbyMode
        ? 'HA'
        : this.isChromeScreen() ? (this.getHeaderTitle() ?? 'HA') : null
      if (!title) return
      const pages = this.headerSensorPages(title)
      if (pages.length > 1) {
        this.headerPage = (this.headerPage + 1) % pages.length
        this.bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: 1,
          containerName: 'header',
          content: this.makeHeaderText(title).content,
        })).catch(console.error)
      }
    }, ms)
  }

  async start() {
    this.bridge.onEvenHubEvent((event) => {
      const sysType = event.sysEvent?.eventType
      if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT || (sysType as number) === 4) {
        this.restartIdleTimer()
        this.render().catch(console.error)
        return
      }
      const eventType = resolveEventType(event)
      if (eventType === undefined) return
      const idx = event.listEvent?.currentSelectItemIndex ?? 0
      this.handleEvent(eventType, idx).catch(err => {
        console.error('[UI] Event handler error:', err)
        this.render().catch(console.error)
      })
    })

    this.ha.onConnectionChange((connected) => {
      this.connected = connected
      this.render().catch(console.error)
    })

    this.ha.onStateChanged(() => {
      if (this.stateDebounce) clearTimeout(this.stateDebounce)
      this.stateDebounce = setTimeout(() => {
        this.updateLivePanels().catch(console.error)
      }, 500)
    })

    this.startPaginateTimers()

    // Scroll ticker — runs every 500ms in scroll mode, skips if content unchanged
    this.scrollTimer = setInterval(() => {
      if (this.rendering) return
      if (getConfig().sensorScrollMode !== 'scroll') return
      this.headerScrollOffset++
      this.footerScrollOffset++
      const title = this.standbyMode
        ? 'HA'
        : this.isChromeScreen() ? (this.getHeaderTitle() ?? 'HA') : null
      if (title) {
        const headerContent = this.makeHeaderText(title).content ?? ''
        if (headerContent !== this.lastHeaderContent) {
          this.lastHeaderContent = headerContent
          this.bridge.textContainerUpgrade(new TextContainerUpgrade({
            containerID: 1,
            containerName: 'header',
            content: headerContent,
          })).catch(console.error)
        }
      }
      if (!this.standbyMode && this.isChromeScreen()) {
        const footerContent = this.footerContent()
        if (footerContent !== this.lastFooterContent) {
          this.lastFooterContent = footerContent
          this.bridge.textContainerUpgrade(new TextContainerUpgrade({
            containerID: 3,
            containerName: 'footer',
            content: footerContent,
          })).catch(console.error)
        }
      }
    }, 500)

    this.prefetchTodoItems()  // fire early — warm cache before user taps Lists
    await this.render()
  }

  private restartIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.autoStandbySeconds <= 0) return
    if (this.standbyMode) return
    this.idleTimer = setTimeout(() => {
      this.enterStandbyIfIdle().catch(console.error)
    }, this.autoStandbySeconds * 1000)
  }

  private async enterStandbyIfIdle() {
    if (this.standbyMode) return
    this.standbyMode = true
    // Keep the screen stack intact — waking returns to exactly where the
    // user left off (e.g. mid-shopping on a todo list). Standby mode itself
    // blocks all non-double-click events, so there's no accidental-tap risk.
    await this.render()
  }

  // --- Container builders ---

  private async rebuildPage(config: {
    containerTotalNum: number
    listObject?: ListContainerProperty[]
    textObject?: TextContainerProperty[]
  }) {
    if (!this.startupRendered) {
      this.startupRendered = true
      await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(config))
      return
    }
    await this.bridge.rebuildPageContainer(new RebuildPageContainer(config))
  }

  private truncate(s: string, max: number): string {
    return s.length <= max ? s : s.substring(0, max - 1) + '\u2026'
  }

  private makeHeaderText(title: string): TextContainerProperty {
    const config = getConfig()
    const clock = config.clock ?? { show: true, format: '24h' }
    let content = ''
    if (clock.show !== false) {
      const now = new Date()
      if (clock.format === '12h') {
        const h = now.getHours() % 12 || 12
        const ampm = now.getHours() < 12 ? 'AM' : 'PM'
        content = `${h}:${String(now.getMinutes()).padStart(2, '0')}${ampm}`
      } else {
        content = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      }
      if (clock.showDate) {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
        content += ` ${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]}`
      }
      content += DOT
    }
    // Disconnected indicator
    if (!this.connected) content += '[!] '

    // Truncate title to 15 chars max
    const truncTitle = title.length > 15 ? title.substring(0, 14) + '\u2026' : title
    content += truncTitle

    // Add header sensors — paginated or scrolling
    if (getConfig().sensorScrollMode === 'scroll') {
      const scrolled = this.headerScrollContent(title)
      if (scrolled) content += DOT + scrolled
    } else {
      const pages = this.headerSensorPages(title)
      if (pages.length > 0) {
        this.headerPage = this.headerPage % pages.length
        for (const part of pages[this.headerPage]) {
          content += DOT + part
        }
      }
    }

    return new TextContainerProperty({
      containerID: 1,
      containerName: 'header',
      content: content.substring(0, 68),
      xPosition: 0,
      yPosition: 0,
      width: W,
      height: HEADER_H,
      borderWidth: 0,
      paddingLength: 4,
      isEventCapture: 0,
    })
  }

  private makeFooterText(): TextContainerProperty {
    return new TextContainerProperty({
      containerID: 3,
      containerName: 'footer',
      content: this.footerContent(),
      xPosition: 0,
      yPosition: H - FOOTER_H,
      width: W,
      height: FOOTER_H,
      borderWidth: 0,
      paddingLength: 4,
      isEventCapture: 0,
    })
  }

  private makeList(items: string[]): ListContainerProperty {
    const capped = items.slice(0, 20).map(s => this.truncate(s, 64))
    return new ListContainerProperty({
      containerID: 2,
      containerName: 'list',
      xPosition: 0,
      yPosition: BODY_TOP,
      width: LIST_W,
      height: BODY_H,
      borderWidth: 0,
      borderRadius: 8,
      paddingLength: 6,
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: capped.length,
        itemWidth: LIST_W - 14,
        isItemSelectBorderEn: 1,
        itemName: capped,
      }),
    })
  }

  private makeEmptyContainer(id: number): TextContainerProperty {
    return new TextContainerProperty({ containerID: id, containerName: `pad${id}`, content: '', xPosition: 0, yPosition: 0, width: 1, height: 1, borderWidth: 0, paddingLength: 0, isEventCapture: 0 })
  }

  private makeStatusBorder(): TextContainerProperty {
    return new TextContainerProperty({
      containerID: 4,
      containerName: 'status_bg',
      content: '',
      xPosition: STATUS_X + 2,
      yPosition: BODY_TOP,
      width: STATUS_W - 4,
      height: BODY_H,
      borderWidth: 1,
      borderColor: 8,
      borderRadius: 8,
      paddingLength: 0,
      isEventCapture: 0,
    })
  }

  private makeStatusText(content: string): TextContainerProperty {
    return new TextContainerProperty({
      containerID: 5,
      containerName: 'status',
      content,
      xPosition: STATUS_X + 20,
      yPosition: BODY_TOP + 4,
      width: STATUS_W - 24,
      height: BODY_H - 8,
      borderWidth: 0,
      paddingLength: 2,
      isEventCapture: 0,
    })
  }

  private makeFullScreen(content: string): TextContainerProperty {
    return new TextContainerProperty({
      containerID: 2,
      containerName: 'text',
      content,
      xPosition: 0,
      yPosition: 0,
      width: W,
      height: H,
      borderWidth: 1,
      borderColor: 5,
      borderRadius: 4,
      paddingLength: 12,
      isEventCapture: 1,
    })
  }

  // --- Status panel content ---

  private static readonly STATUS_LINES_PER_PAGE = 6
  private static readonly STATUS_LINE_MAX = 20

  private statusTrunc(s: string): string {
    return s.length > UI.STATUS_LINE_MAX ? s.substring(0, UI.STATUS_LINE_MAX - 1) + '\u2026' : s
  }

  // icon · ratio(5) · · name — columns align regardless of x/x vs xx/xx
  private statusCountLine(on: number, total: number, name: string): string {
    const icon = on > 0 ? '\u2022' : ' '
    const ratio = `${on}/${total}`.padStart(5)
    const truncName = this.truncate(name, 13)
    return `${icon} ${ratio}  ${truncName}`
  }

  private getStatusTitle(): string {
    switch (this.screen.type) {
      case 'home': return 'Overview'
      case 'favorites': return `Favorites (${this.favorites.length})`
      case 'rooms': return `Rooms (${this.rooms.size})`
      case 'room': {
        const c = this.countStates(this.screen.entityIds)
        return `${this.screen.name} ${c.on}/${c.total}`
      }
      case 'submenu': return this.entityName(this.screen.entityId)
      default: return ''
    }
  }

  private getStatusLines(): string[] {
    const offStates = new Set(['off', 'closed', 'locked', 'idle', 'standby', 'unavailable', 'unknown', 'disarmed', ''])
    const isActive = (state: string) => !offStates.has(state)
    const entityLine = (id: string) => {
      const e = this.ha.getEntity(id)
      const s = e?.state ?? '?'
      return `${isActive(s) ? '\u2022' : '  '} ${this.statusTrunc(this.entityName(id))}`
    }

    switch (this.screen.type) {
      case 'home': {
        const allIds = new Set<string>()
        for (const f of this.favorites) allIds.add(f.entity_id)
        for (const ids of this.rooms.values()) ids.forEach(id => allIds.add(id))
        const domainCounts: Record<string, { on: number; total: number }> = {}
        for (const id of allIds) {
          const domain = id.split('.')[0]
          const state = this.ha.getEntity(id)?.state ?? 'unknown'
          if (!domainCounts[domain]) domainCounts[domain] = { on: 0, total: 0 }
          domainCounts[domain].total++
          if (isActive(state)) domainCounts[domain].on++
        }
        const labels: Record<string, string> = { light: 'Lights', switch: 'Switches', fan: 'Fans', cover: 'Covers', lock: 'Locks', climate: 'Climate', scene: 'Scenes', script: 'Scripts', input_boolean: 'Inputs' }
        return Object.entries(domainCounts)
          .sort((a, b) => b[1].on - a[1].on || b[1].total - a[1].total)
          .map(([d, c]) => this.statusCountLine(c.on, c.total, labels[d] || d))
      }
      case 'favorites':
        return this.sortStatusEntities(this.favorites.map(f => f.entity_id)).map(id => entityLine(id))
      case 'rooms': {
        const mode = getConfig().statusPanelSort ?? 'status'
        let roomEntries = this.getSortedRoomNames().map(name => {
          const ids = this.rooms.get(name)!
          const c = this.countStates(ids)
          return { name, c }
        })
        if (mode === 'status') {
          roomEntries = roomEntries.sort((a, b) => b.c.on - a.c.on || a.name.localeCompare(b.name))
        } else if (mode === 'name') {
          roomEntries = roomEntries.sort((a, b) => a.name.localeCompare(b.name))
        }
        return roomEntries.map(({ name, c }) => this.statusCountLine(c.on, c.total, name))
      }
      case 'room':
        return this.sortStatusEntities(this.screen.entityIds).map(id => entityLine(id))
      case 'submenu': {
        const e = this.ha.getEntity(this.screen.entityId)
        const lines: string[] = [e?.state?.toUpperCase() ?? '?']
        if (e?.attributes) {
          const a = e.attributes
          if (a.brightness != null) lines.push(`Bright: ${Math.round((a.brightness as number) / 255 * 100)}%`)
          if (a.color_temp_kelvin != null) lines.push(`Temp: ${a.color_temp_kelvin}K`)
          if (a.rgb_color) { const [r, g, b] = a.rgb_color as number[]; lines.push(`RGB: ${r},${g},${b}`) }
          if (a.current_temperature != null) lines.push(`Temp: ${a.current_temperature}${a.temperature_unit || '\u00b0'}`)
          if (a.hvac_action) lines.push(`${a.hvac_action}`)
          if (a.percentage != null) lines.push(`Speed: ${a.percentage}%`)
          if (a.current_position != null) lines.push(`Pos: ${a.current_position}%`)
          if (a.media_title) lines.push(`${this.statusTrunc(a.media_title as string)}`)
          if (a.media_artist) lines.push(`${this.statusTrunc(a.media_artist as string)}`)
          if (a.source) lines.push(`Src: ${this.statusTrunc(a.source as string)}`)
          if (a.battery_level != null) lines.push(`Bat: ${a.battery_level}%`)
          if (a.device_class && !lines.some(l => l.includes(a.device_class as string))) lines.push(`${a.device_class}`)
        }
        return lines
      }
      default:
        return []
    }
  }

  private formatStatusText(): string {
    const title = this.getStatusTitle()
    const lines = this.getStatusLines()
    if (lines.length === 0) return title ? `${title}\nNo entities` : 'No entities'
    const perPage = UI.STATUS_LINES_PER_PAGE
    const totalPages = Math.ceil(lines.length / perPage)
    if (this.statusPage >= totalPages) this.statusPage = 0
    const start = this.statusPage * perPage
    const page = lines.slice(start, start + perPage)
    const pageIndicator = totalPages > 1 ? `  ${this.statusPage + 1}/${totalPages}` : ''
    return `${title}${pageIndicator}\n${page.join('\n')}`
  }

  // --- Footer content ---

  private sensorPart(slot: SensorSlot): string {
    const raw = this.ha.getEntity(slot.entity_id)?.state ?? '?'
    if (!this.meetsCondition(slot, raw)) return ''
    const label = slot.label === '' ? '' : (getConfig().customNames[slot.entity_id] || slot.label)
    const numRaw = Number(raw)
    if (!isNaN(numRaw)) {
      const scaled = slot.divisor ? numRaw / slot.divisor : numRaw
      const formatted = Number.isInteger(scaled) ? `${scaled}` : `${Number(scaled.toFixed(1))}`
      const unit = slot.unitOverride ?? slot.unit ?? ''
      const valuePart = `${formatted}${unit ? ' ' + unit : ''}`
      return label ? `${label} ${valuePart}` : valuePart
    }
    // Non-numeric state — unitOverride replaces the state text (e.g. "!" as a warning)
    const display = slot.unitOverride ?? raw
    return label ? `${label} ${display}` : display
  }

  private footerPages(): string[] {
    if (this.footerSensors.length === 0) return ['']
    const parts = this.footerSensors.map(s => this.sensorPart(s)).filter(Boolean)
    const allJoined = parts.join(DOT)
    if (allJoined.length <= 66) return [allJoined]

    const maxLen = 58
    const pages: string[] = []
    let current = ''
    for (const part of parts) {
      const candidate = current ? `${current}${DOT}${part}` : part
      if (candidate.length > maxLen && current) {
        pages.push(current)
        current = part
      } else {
        current = candidate
      }
    }
    if (current) pages.push(current)
    return pages.map((p, i) => `${i + 1}/${pages.length}${DOT}${p}`)
  }

  private footerContent(): string {
    if (getConfig().sensorScrollMode === 'scroll') return this.footerScrollContent()
    const pages = this.footerPages()
    if (pages.length === 0) return ''
    this.footerPage = this.footerPage % pages.length
    return pages[this.footerPage]
  }

  private meetsCondition(slot: SensorSlot, rawState: string): boolean {
    if (!slot.condition) return true
    const { operator, value } = slot.condition
    const numState = parseFloat(rawState)
    const numValue = parseFloat(value)
    if (!isNaN(numState) && !isNaN(numValue)) {
      switch (operator) {
        case '>':  return numState > numValue
        case '<':  return numState < numValue
        case '>=': return numState >= numValue
        case '<=': return numState <= numValue
        case '==': return numState === numValue
        case '!=': return numState !== numValue
      }
    }
    switch (operator) {
      case '==': return rawState === value
      case '!=': return rawState !== value
      default:   return true
    }
  }

  private headerSensorPart(slot: SensorSlot): string {
    const entity = this.ha.getEntity(slot.entity_id)
    if (!entity) return ''
    if (!this.meetsCondition(slot, entity.state)) return ''
    const label = slot.label === '' ? '' : (getConfig().customNames[slot.entity_id] || slot.label || '')
    const rawState = entity.state
    const numVal = parseFloat(rawState)
    if (!isNaN(numVal) && rawState.trim() !== '') {
      const scaled = slot.divisor ? numVal / slot.divisor : numVal
      const unit = slot.unitOverride ?? (entity.attributes.unit_of_measurement as string) ?? ''
      const formatted = Number.isInteger(scaled) ? `${scaled}` : `${Number(scaled.toFixed(1))}`
      return label ? `${label} ${formatted}${unit}` : `${formatted}${unit}`
    }
    // Non-numeric state — unitOverride replaces the state text
    const display = slot.unitOverride ?? rawState
    return label ? `${label} ${display}` : display
  }

  private clockDisplayLen(): number {
    const clock = getConfig().clock ?? { show: true, format: '24h' }
    if (clock.show === false) return 0
    const timeLen = clock.format === '12h' ? 7 : 5 // "12:00AM" or "14:00"
    const dateLen = clock.showDate ? 11 : 0 // " Wed 11 Apr"
    return timeLen + dateLen + DOT.length
  }

  private headerSensorPages(title: string): string[][] {
    if (this.headerSensors.length === 0) return [[]]
    const clockLen = this.clockDisplayLen()
    const titleLen = Math.min(title.length, 15) + DOT.length
    const budget = 68 - clockLen - titleLen
    const parts = this.headerSensors.map(s => this.headerSensorPart(s)).filter(Boolean)
    if (parts.join(DOT).length <= budget) return [parts]

    const pages: string[][] = []
    let current: string[] = []
    for (const part of parts) {
      const candidate = [...current, part]
      if (candidate.join(DOT).length > budget && current.length > 0) {
        pages.push(current)
        current = [part]
      } else {
        current = candidate
      }
    }
    if (current.length > 0) pages.push(current)
    return pages
  }

  private headerScrollContent(title: string): string {
    const clockLen = this.clockDisplayLen()
    const titleLen = Math.min(title.length, 15) + DOT.length
    const budget = 68 - clockLen - titleLen
    const parts = this.headerSensors.map(s => this.headerSensorPart(s)).filter(Boolean)
    if (parts.length === 0 || parts.join(DOT).length <= budget) return parts.join(DOT)
    const loop = parts.join(DOT) + DOT + DOT
    const offset = this.headerScrollOffset % loop.length
    const shifted = loop.substring(offset) + loop
    return shifted.substring(0, budget)
  }

  private footerScrollContent(): string {
    if (this.footerSensors.length === 0) return ''
    const parts = this.footerSensors.map(s => this.sensorPart(s)).filter(Boolean)
    const joined = parts.join(DOT)
    if (joined.length <= 66) return joined
    const loop = joined + DOT + DOT
    const offset = this.footerScrollOffset % loop.length
    const shifted = loop.substring(offset) + loop
    return shifted.substring(0, 66)
  }

  // --- Header title ---

  private getHeaderTitle(): string | null {
    switch (this.screen.type) {
      case 'home':
        return 'HA'
      case 'favorites':
        return 'Favorites'
      case 'rooms':
        return 'Rooms'
      case 'room':
        return this.screen.name
      case 'submenu':
        return this.entityName(this.screen.entityId)
      default:
        return null
    }
  }

  // --- Live updates ---

  private isChromeScreen(): boolean {
    const t = this.screen.type
    return t === 'home' || t === 'favorites' || t === 'rooms' || t === 'room' || t === 'submenu'
  }

  private async updateLivePanels() {
    if (!this.startupRendered || this.rendering) return
    if (this.standbyMode) {
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1,
        containerName: 'header',
        content: this.makeHeaderText('HA').content,
      }))
      return
    }
    if (!this.isChromeScreen()) return
    const screen = this.screen

    // Update status text
    await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 5,
      containerName: 'status',
      content: this.formatStatusText(),
    }))

    // Update header text
    const headerTitle = this.getHeaderTitle()
    if (headerTitle) {
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1,
        containerName: 'header',
        content: this.makeHeaderText(headerTitle).content,
      }))
    }

    // Update footer text
    if (screen.type === 'home' || screen.type === 'favorites' || screen.type === 'rooms' || screen.type === 'room' || screen.type === 'submenu') {
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 3,
        containerName: 'footer',
        content: this.footerContent(),
      }))
    }
  }

  // --- Status rotation ---

  private startStatusRotation() {
    if (this.statusTimer) clearInterval(this.statusTimer)
    const lines = this.getStatusLines()
    const totalPages = Math.ceil(lines.length / UI.STATUS_LINES_PER_PAGE)
    if (totalPages <= 1) return
    this.statusTimer = setInterval(() => {
      if (this.rendering || !this.isChromeScreen()) return
      this.statusPage = (this.statusPage + 1) % totalPages
      this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 5,
        containerName: 'status',
        content: this.formatStatusText(),
      })).catch(console.error)
    }, 4000)
  }

  private stopStatusRotation() {
    if (this.statusTimer) {
      clearInterval(this.statusTimer)
      this.statusTimer = null
    }
    this.statusPage = 0
  }

  // --- Screen renderers ---

  async render() {
    this.rendering = true
    const safety = setTimeout(() => { this.rendering = false }, 8000)
    try {
      this.stopStatusRotation()
      // Cancel pending state update to prevent it firing on non-chrome screens
      if (this.stateDebounce) {
        clearTimeout(this.stateDebounce)
        this.stateDebounce = null
      }
      if (this.standbyMode) {
        await this.renderStandby()
      } else {
        switch (this.screen.type) {
          case 'home':     await this.renderHome(); break
          case 'favorites': await this.renderFavorites(); break
          case 'rooms':    await this.renderRooms();    break
          case 'room':     await this.renderRoom();     break
          case 'submenu':  await this.renderSubmenu();  break
          case 'confirm':  await this.renderConfirm();  break
          case 'result':   await this.renderResult();   break
          case 'loading':  await this.renderLoading();  break
          case 'todoLists': await this.renderTodoLists(); break
          case 'todoList': await this.renderTodoList(); break
          case 'todoDetail': await this.renderTodoDetail(); break
          case 'todoRead': await this.renderTodoRead(); break
          case 'todoDeleteConfirm': await this.renderTodoDeleteConfirm(); break
        }
      }
    } finally {
      clearTimeout(safety)
      this.rendering = false
    }
  }

  private async renderWithChrome(header: string, items: string[]) {
    this.statusPage = 0
    await this.rebuildPage({
      containerTotalNum: 5,
      listObject: [this.makeList(items)],
      textObject: [
        this.makeHeaderText(header),
        this.makeFooterText(),
        this.makeStatusBorder(),
        this.makeStatusText(this.formatStatusText()),
      ],
    })
    this.startStatusRotation()
  }

  private async renderStandby() {
    await this.rebuildPage({
      containerTotalNum: 2,
      textObject: [
        this.makeHeaderText('HA'),
        new TextContainerProperty({
          containerID: 2,
          containerName: 'standby-capture',
          content: '',
          xPosition: 0,
          yPosition: HEADER_H,
          width: W,
          height: H - HEADER_H,
          borderWidth: 0,
          paddingLength: 0,
          isEventCapture: 1,
        }),
      ],
    })
  }

  private async renderHome() {
    const recent = getConfig().recentlyUsed.slice(0, 18)
    const favCount = this.favorites.length
    const roomCount = this.rooms.size
    const todoCount = this.enabledTodoLists.length
    const items = [
      `\u2605 Favorites (${favCount}) ${ARROW_R}`,
      `\u25A3 Rooms (${roomCount}) ${ARROW_R}`,
    ]
    if (todoCount > 0) items.push(`\u25A4 Lists (${todoCount}) ${ARROW_R}`)
    for (const id of recent) items.push(this.entityLabel(id))
    await this.renderWithChrome('HA', items)
  }

  private prefetchTodoItems() {
    const enabled = this.ha.getTodoEntities().filter(e => this.enabledTodoLists.includes(e.entity_id))
    if (enabled.length !== 1) return
    const entityId = enabled[0].entity_id
    if (this.todoEntityId === entityId && this.todoSortedItems !== null) return  // already warm
    this.ha.getTodoItems(entityId).then(items => {
      if (this.todoEntityId === entityId) return  // user already navigated, don't overwrite
      const pending = items.filter(i => !i.done)
      const done = items.filter(i => i.done)
      this.todoSortedItems = [...pending, ...done].slice(0, 20)
      this.todoEntityId = entityId
    }).catch(() => {})
  }

  private async renderFavorites() {
    if (this.favorites.length === 0) {
      await this.rebuildPage({
        containerTotalNum: 2,
        textObject: [this.makeFullScreen('\n\nNo favorites yet\n\nAdd entities using the\ncompanion app on your phone')],
      })
      return
    }
    const items = this.favorites.map(f => this.entityLabel(f.entity_id))
    const counts = this.countStates(this.favorites.map(f => f.entity_id))
    await this.renderWithChrome(`Favorites ${counts.on} on / ${counts.off} off`, items)
  }

  private async renderRooms() {
    const roomNames = this.getSortedRoomNames()
    if (roomNames.length === 0) {
      await this.rebuildPage({
        containerTotalNum: 2,
        textObject: [this.makeFullScreen('\n\nNo rooms configured\n\nConfigure rooms using the\ncompanion app on your phone')],
      })
      return
    }
    this.sortedRoomNames = roomNames
    const items = roomNames.map(name => {
      const ids = this.rooms.get(name)!
      const c = this.countStates(ids)
      return `${name}  ${c.on}/${c.total} ${ARROW_R}`
    })
    await this.renderWithChrome(`Rooms (${this.rooms.size})`, items)
  }

  private async renderRoom() {
    if (this.screen.type !== 'room') return
    const { name } = this.screen
    const canonical = this.rooms.get(name) ?? this.screen.entityIds
    const entityIds = this.sortRoomEntities(name, canonical)
    this.screen.entityIds = entityIds
    const items = entityIds.map(id => this.entityLabel(id))
    const c = this.countStates(entityIds)
    await this.renderWithChrome(`${name} ${c.on}/${c.total}`, items)
  }

  // --- Todo: state ---
  private todoSortedItems: import('./ha-client').TodoItem[] | null = null
  private todoEntityId: string | null = null   // which entity the cache belongs to
  private todoSelectedIdx = 0
  private todoReadPage = 0
  private todoDetailActions: Array<'toggle' | 'read' | 'delete'> = []

  // --- Todo: date formatting ---
  private formatTodoDue(due?: string): string {
    if (!due) return ''
    const d = new Date(due)
    const hasTime = due.includes('T') || /\d{4}-\d{2}-\d{2} \d{2}:/.test(due)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dLocal = hasTime ? d : new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const overdueFrom = hasTime ? d : new Date(dLocal.getTime() + 86400000)
    const diffMs = now.getTime() - overdueFrom.getTime()
    const overdue = diffMs > 0
    const absDiffMin = Math.floor(Math.abs(diffMs) / 60000)
    const absDiffHrs = Math.floor(Math.abs(diffMs) / 3600000)
    const target = new Date(dLocal.getFullYear(), dLocal.getMonth(), dLocal.getDate())
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000)
    if (overdue) {
      if (absDiffMin < 1) return 'Just now'
      if (absDiffMin < 60) return `${absDiffMin} min ago`
      if (absDiffHrs < 24) return `${absDiffHrs} hr${absDiffHrs > 1 ? 's' : ''} ago`
      const days = Math.floor(absDiffHrs / 24)
      if (days === 1) return '1 day ago'
      if (days < 7) return `${days} days ago`
      const weeks = Math.floor(days / 7)
      if (weeks === 1) return '1 week ago'
      if (weeks < 4) return `${weeks} weeks ago`
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
      return `${dLocal.getDate()} ${months[dLocal.getMonth()]}`
    }
    if (hasTime && absDiffMin < 60) return `In ${absDiffMin} min`
    if (hasTime && absDiffHrs < 6) return `In ${absDiffHrs} hr${absDiffHrs > 1 ? 's' : ''}`
    if (diffDays === 0) {
      if (!hasTime) return 'Today'
      const clock = getConfig().clock ?? { show: true, format: '24h' }
      if (clock.format === '12h') {
        const h = d.getHours() % 12 || 12
        return `Today ${h}:${String(d.getMinutes()).padStart(2,'0')}${d.getHours() < 12 ? 'am' : 'pm'}`
      }
      return `Today ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
    }
    if (diffDays === 1) return 'Tomorrow'
    if (diffDays > 1 && diffDays <= 6) return `In ${diffDays} days`
    const weeks = Math.floor(Math.abs(diffDays) / 7)
    if (weeks === 1) return 'In 1 week'
    if (weeks > 1 && weeks < 5) return `In ${weeks} weeks`
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${dLocal.getDate()} ${months[dLocal.getMonth()]}`
  }

  // --- Todo: item label builder (max 62 chars for SDK) ---
  private todoItemLabel(item: import('./ha-client').TodoItem): string {
    const MAX = 62
    const icon = item.done ? '\u25cf' : '\u25cb'
    const due = this.formatTodoDue(item.due)
    const desc = item.description ? item.description.replace(/\n/g, ' ').trim() : ''
    const summaryMax = due ? Math.min(item.summary.length, 24) : Math.min(item.summary.length, 36)
    let line = `${icon} ${this.truncate(item.summary, summaryMax)}`
    if (due) line += `  ${due}`
    if (desc) {
      const remaining = Math.min(20, MAX - line.length - 2)
      if (remaining > 4) line += `  ${this.truncate(desc, remaining)}`
    }
    return line.substring(0, MAX)
  }

  // --- Todo: renderers (ALL use renderWithChrome — proven on glasses) ---

  private async renderTodoLists() {
    const allTodoEntities = this.ha.getTodoEntities()
    const todoEntities = allTodoEntities.filter(e => this.enabledTodoLists.includes(e.entity_id))
    const labels = todoEntities.length === 0
      ? ['No lists enabled']
      : todoEntities.map(entity => {
          const name = (entity.attributes?.friendly_name as string) || entity.entity_id.split('.').pop() || ''
          return `${name} (${entity.state ?? '?'}) ${ARROW_R}`
        })
    const header = todoEntities.length === 0 ? 'Lists' : `Lists (${todoEntities.length})`
    await this.rebuildPage({
      containerTotalNum: 3,
      listObject: [new ListContainerProperty({
        containerID: 2, containerName: 'todolists',
        xPosition: 0, yPosition: BODY_TOP, width: W, height: BODY_H,
        borderWidth: 0, borderRadius: 0, paddingLength: 6, isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: labels.length, itemWidth: W - 16,
          isItemSelectBorderEn: 1, itemName: labels,
        }),
      })],
      textObject: [this.makeHeaderText(header), this.makeFooterText()],
    })
  }

  private fetchAndRenderTodoList(entityId: string) {
    this.ha.getTodoItems(entityId)
      .then(items => {
        if (this.screen.type !== 'todoList') return
        const pending = items.filter(i => !i.done)
        const done = items.filter(i => i.done)
        this.todoSortedItems = [...pending, ...done].slice(0, 20)
        this.todoSelectedIdx = 0
        setTimeout(() => this.render().catch(console.error), 300)
      })
      .catch(() => {
        if (this.screen.type !== 'todoList') return
        setTimeout(() => this.render().catch(console.error), 300)
      })
  }

  private async renderTodoList() {
    if (this.screen.type !== 'todoList') return
    const { entityId } = this.screen
    const name = (this.ha.getEntity(entityId)?.attributes?.friendly_name as string) || entityId.split('.').pop() || ''

    const items = this.todoSortedItems  // null = loading, [] = empty, [...] = loaded
    const loading = items === null
    const pending = items?.filter(i => !i.done) ?? []
    const done = items?.filter(i => i.done) ?? []
    const header = loading ? name : `${name}  ${done.length}/${pending.length + done.length} done`
    const labels = loading
      ? ['Loading...']
      : items!.length === 0 ? ['No items in list'] : items!.map(i => this.todoItemLabel(i))

    await this.rebuildPage({
      containerTotalNum: 3,
      listObject: [new ListContainerProperty({
        containerID: 2,
        containerName: 'todolist',
        xPosition: 0,
        yPosition: BODY_TOP,
        width: W,
        height: BODY_H,
        borderWidth: 0,
        borderRadius: 0,
        paddingLength: 6,
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: labels.length,
          itemWidth: W - 16,
          isItemSelectBorderEn: 1,
          itemName: labels,
        }),
      })],
      textObject: [
        this.makeHeaderText(header),
        this.makeFooterText(),
      ],
    })
  }

  private async renderTodoDetail() {
    const screen = this.screen
    if (screen.type !== 'todoDetail') return
    const item = this.todoSortedItems?.find(i => i.uid === screen.itemUid)
    if (!item) { await this.goBack(); return }

    const icon = item.done ? '\u25cf' : '\u25cb'
    const actionLabel = item.done ? '\u25cb Mark pending' : '\u25cf Mark done'
    const actions: string[] = [actionLabel]

    const ACTION_W = 200
    const INFO_X = ACTION_W + 8
    const INFO_W = W - INFO_X - 4
    const PADDING = 8
    const charsWide = Math.floor((INFO_W - PADDING * 2) / 10)
    const LINE_H = 24  // conservative — actual rendering is ~22-24px per line
    const maxLines = Math.floor((BODY_H - PADDING * 2) / LINE_H)

    // Build info lines — status + due first, then description word-wrapped to fit
    const infoLines: string[] = []
    infoLines.push(item.done ? 'Done' : 'Pending')
    if (item.due) infoLines.push(this.formatTodoDue(item.due))

    let descTruncated = false
    if (item.description) {
      infoLines.push('')
      const available = Math.min(4, maxLines - infoLines.length)  // hard cap: 4 desc lines max
      if (available > 0) {
        const words = item.description.replace(/\r?\n/g, ' ').trim().split(/\s+/)
        const wrapped: string[] = []
        let cur = ''
        for (const w of words) {
          if (cur === '') { cur = w; continue }
          if ((cur + ' ' + w).length <= charsWide) { cur += ' ' + w }
          else { wrapped.push(cur); cur = w }
        }
        if (cur) wrapped.push(cur)
        if (wrapped.length > available) {
          descTruncated = true
          const fits = wrapped.slice(0, available)
          fits[fits.length - 1] = this.truncate(fits[fits.length - 1], charsWide - 1) + '\u2026'
          infoLines.push(...fits)
        } else {
          infoLines.push(...wrapped)
        }
      } else {
        descTruncated = !!item.description
      }
    }

    const actionKinds: Array<'toggle' | 'read' | 'delete'> = ['toggle']
    if (descTruncated) {
      actions.push(`Read description ${ARROW_R}`)
      actionKinds.push('read')
    }
    actions.push('Delete item')
    actionKinds.push('delete')
    this.todoDetailActions = actionKinds
    const infoText = infoLines.join('\n').substring(0, 900)

    await this.rebuildPage({
      containerTotalNum: 5,
      listObject: [new ListContainerProperty({
        containerID: 2,
        containerName: 'todo-actions',
        xPosition: 0,
        yPosition: BODY_TOP,
        width: ACTION_W,
        height: BODY_H,
        borderWidth: 0,
        paddingLength: 6,
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: actions.length,
          itemWidth: ACTION_W - 12,
          isItemSelectBorderEn: 1,
          itemName: actions,
        }),
      })],
      textObject: [
        this.makeHeaderText(`${icon} ${this.truncate(item.summary, 40)}`),
        this.makeFooterText(),
        new TextContainerProperty({
          containerID: 4,
          containerName: 'todo-info',
          xPosition: INFO_X,
          yPosition: BODY_TOP,
          width: INFO_W,
          height: BODY_H,
          borderWidth: 1,
          borderRadius: 4,
          paddingLength: 8,
          content: infoText,
          isEventCapture: 0,
        }),
        this.makeEmptyContainer(5),
      ],
    })
  }

  private paginateText(text: string, charsPerLine: number, linesPerPage: number): string[] {
    const words = text.replace(/\r/g, '').trim().split(/\s+/)
    const allLines: string[] = []
    let cur = ''
    for (const word of words) {
      if (cur === '') { cur = word; continue }
      if ((cur + ' ' + word).length <= charsPerLine) {
        cur += ' ' + word
      } else {
        allLines.push(cur)
        cur = word
      }
    }
    if (cur) allLines.push(cur)
    const pages: string[] = []
    for (let i = 0; i < allLines.length; i += linesPerPage) {
      pages.push(allLines.slice(i, i + linesPerPage).join('\n'))
    }
    return pages.length > 0 ? pages : ['']
  }

  private async renderTodoRead() {
    if (this.screen.type !== 'todoRead') return
    const { text, title } = this.screen
    const PADDING = 8
    const charsPerLine = Math.floor((W - PADDING * 2) / 10)
    const linesPerPage = Math.floor((BODY_H - PADDING * 2) / 18)
    const pages = this.paginateText(text, charsPerLine, linesPerPage)
    const page = Math.max(0, Math.min(this.todoReadPage, pages.length - 1))
    this.todoReadPage = page
    const totalPages = pages.length
    const header = totalPages > 1
      ? `${this.truncate(title, 32)}  ${page + 1}/${totalPages}`
      : this.truncate(title, 40)
    await this.rebuildPage({
      containerTotalNum: 3,
      textObject: [
        this.makeHeaderText(header),
        new TextContainerProperty({
          containerID: 2,
          containerName: 'todo-read',
          xPosition: 0,
          yPosition: BODY_TOP,
          width: W,
          height: BODY_H,
          borderWidth: 0,
          paddingLength: PADDING,
          content: pages[page],
          isEventCapture: 1,
        }),
        this.makeFooterText(),
      ],
    })
  }

  // --- Todo: event handlers ---

  private async todoListsSelect(idx: number) {
    const allTodoEntities = this.ha.getTodoEntities()
    const todoEntities = allTodoEntities.filter(e => this.enabledTodoLists.includes(e.entity_id))
    if (idx >= todoEntities.length) return
    const entityId = todoEntities[idx].entity_id
    this.todoSortedItems = null
    this.todoSelectedIdx = 0
    this.push({ type: 'todoList', entityId })
    await this.render()  // show Loading... immediately
    try {
      const items = await Promise.race([
        this.ha.getTodoItems(entityId),
        new Promise<import('./ha-client').TodoItem[]>(resolve => setTimeout(() => resolve([]), 8000)),
      ])
      const pending = items.filter(i => !i.done)
      const done = items.filter(i => i.done)
      this.todoSortedItems = [...pending, ...done].slice(0, 20)
      this.todoSelectedIdx = 0
    } catch { /* keep empty */ }
    if (this.screen.type === 'todoList') await this.render()
  }

  private async todoItemSelect(idx: number) {
    if (this.screen.type !== 'todoList') return
    const sorted = this.todoSortedItems
    if (!sorted || sorted.length === 0) return  // still loading or empty
    if (idx >= sorted.length) return
    const item = sorted[idx]
    this.push({ type: 'todoDetail', entityId: this.screen.entityId, itemUid: item.uid })
    await this.render()
  }

  private async todoDetailSelect(idx: number) {
    if (this.screen.type !== 'todoDetail') return
    const { entityId, itemUid } = this.screen
    const item = this.todoSortedItems?.find(i => i.uid === itemUid)
    if (!item) return
    // Dispatch by last-rendered action at this index
    const action = this.todoDetailActions[idx]
    if (action === 'delete') {
      this.push({ type: 'todoDeleteConfirm', entityId, itemUid: item.uid, summary: item.summary })
      await this.render()
      return
    }
    if (action === 'read') {
      if (!item.description) return
      this.todoReadPage = 0
      this.push({ type: 'todoRead', text: item.description, title: this.truncate(item.summary, 40) })
      await this.render()
      return
    }
    if (action !== 'toggle') return
    if (idx === 0) {
      // Toggle done/pending
      const markingDone = !item.done
      await this.ha.updateTodoItem(entityId, item.uid, markingDone)
      // Refresh items then go back to list
      try {
        const fresh = await Promise.race([
          this.ha.getTodoItems(entityId),
          new Promise<import('./ha-client').TodoItem[]>(resolve => setTimeout(() => resolve([]), 5000)),
        ])
        const p = fresh.filter(i => !i.done)
        const d = fresh.filter(i => i.done)
        this.todoSortedItems = [...p, ...d].slice(0, 20)
        this.todoSelectedIdx = 0
      } catch { /* keep old */ }
      this.screenStack.pop() // pop todoDetail → back to todoList
      await this.render()
    }
  }

  private async renderTodoDeleteConfirm() {
    if (this.screen.type !== 'todoDeleteConfirm') return
    const { summary } = this.screen
    const title = this.truncate(summary, 36)
    await this.rebuildPage({
      containerTotalNum: 2,
      listObject: [new ListContainerProperty({
        containerID: 1,
        containerName: 'confirm',
        xPosition: UI.ACTION_BOX_X,
        yPosition: 10,
        width: UI.ACTION_BOX_W,
        height: 110,
        borderWidth: 0,
        borderRadius: 4,
        paddingLength: 8,
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: 2,
          itemWidth: UI.ACTION_BOX_W - 16,
          isItemSelectBorderEn: 1,
          itemName: [
            'Cancel',
            'Delete',
          ],
        }),
      })],
      textObject: [(() => {
        const box = this.makeFullCentered('Delete item?', title, undefined, 165)
        box.isEventCapture = 0
        return box
      })()],
    })
  }

  private async todoDeleteConfirmSelect(idx: number) {
    if (this.screen.type !== 'todoDeleteConfirm') return
    const { entityId, itemUid } = this.screen
    if (idx === 0) {
      // Cancel → back to detail
      this.screenStack.pop()
      await this.render()
      return
    }
    if (idx === 1) {
      // Delete → remove via HA, refresh cache, pop back to list
      try {
        await this.ha.removeTodoItem(entityId, itemUid)
        const fresh = await Promise.race([
          this.ha.getTodoItems(entityId),
          new Promise<import('./ha-client').TodoItem[]>(resolve => setTimeout(() => resolve([]), 5000)),
        ])
        const p = fresh.filter(i => !i.done)
        const d = fresh.filter(i => i.done)
        this.todoSortedItems = [...p, ...d].slice(0, 20)
        this.todoSelectedIdx = 0
      } catch { /* ignore, still pop */ }
      // Pop both the confirm and the detail screens → back to list
      this.screenStack.pop()  // pop confirm
      this.screenStack.pop()  // pop detail
      await this.render()
    }
  }

  private async renderSubmenu() {
    if (this.screen.type !== 'submenu') return
    const { entityId } = this.screen
    const entity = this.ha.getEntity(entityId)
    const state = entity?.state ?? '?'

    const freshItems = buildSubItems(entityId, entity) ?? this.screen.items
    this.screenStack[this.screenStack.length - 1] = { type: 'submenu', entityId, items: freshItems }

    const listItems = freshItems.map(i => `${ARROW_R} ${i.label}`)
    await this.renderWithChrome(`${this.entityName(entityId)} ${state.toUpperCase()}`, listItems)
  }

  // Shared centered box for confirm/result/loading screens
  private static readonly ACTION_BOX_W = 280
  private static readonly ACTION_BOX_X = (W - 280) / 2
  private static readonly ACTION_BOX_H = 100

  private isFavourite(entityId: string): boolean {
    return getConfig().favorites.some(f => f.entity_id === entityId)
  }

  private async renderConfirm() {
    if (this.screen.type !== 'confirm') return
    const { entityId, action } = this.screen
    const name = this.truncate(this.entityName(entityId), 28)
    const favLabel = this.isFavourite(entityId) ? '\u2606  Remove Favourite' : '\u2605  Add Favourite'

    await this.rebuildPage({
      containerTotalNum: 2,
      listObject: [new ListContainerProperty({
        containerID: 1,
        containerName: 'confirm',
        xPosition: UI.ACTION_BOX_X,
        yPosition: 10,
        width: UI.ACTION_BOX_W,
        height: 124,
        borderWidth: 0,
        borderRadius: 4,
        paddingLength: 8,
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: 3,
          itemWidth: UI.ACTION_BOX_W - 16,
          isItemSelectBorderEn: 1,
          itemName: [
            'Cancel',
            `${action}`,
            favLabel,
          ],
        }),
      })],
      textObject: [(() => {
        const box = this.makeFullCentered(name, action, undefined, 185)
        box.isEventCapture = 0
        return box
      })()],
    })
  }

  private makeFullCentered(line1: string, line2: string, line3?: string, yPos?: number): TextContainerProperty {
    return new TextContainerProperty({
      containerID: 2,
      containerName: 'action',
      content: [line1, line2, line3].filter(Boolean).join('\n'),
      xPosition: UI.ACTION_BOX_X,
      yPosition: yPos ?? (H / 2 - 50),
      width: UI.ACTION_BOX_W,
      height: UI.ACTION_BOX_H,
      borderWidth: 1,
      borderColor: 8,
      borderRadius: 12,
      paddingLength: 8,
      isEventCapture: 1,
    })
  }

  private async renderResult() {
    if (this.screen.type !== 'result') return
    const { entityId, success, action } = this.screen
    const name = this.truncate(this.entityName(entityId), 26)
    const truncAction = this.truncate(action, 26)
    const icon = success ? 'OK' : 'FAIL'

    await this.rebuildPage({
      containerTotalNum: 2,
      textObject: [this.makeFullCentered(
        `${icon} ${success ? 'Success' : 'Failed'}`,
        name,
        truncAction,
      )],
    })
  }

  private async renderLoading() {
    if (this.screen.type !== 'loading') return
    const lines = this.screen.message.split('\n')
    await this.rebuildPage({
      containerTotalNum: 2,
      textObject: [this.makeFullCentered(
        'Sending...',
        this.truncate(lines[0] || '', 26),
        lines[1] ? this.truncate(lines[1], 26) : undefined,
      )],
    })
  }

  // --- Event handling ---

  private eventBusy = false
  private async handleEvent(eventType: OsEventTypeList, idx: number): Promise<void> {
    if (this.rendering || this.eventBusy) return
    // Reset idle timer on any real ring interaction (click / scroll / double-click)
    if (eventType !== OsEventTypeList.IMU_DATA_REPORT) {
      this.restartIdleTimer()
    }
    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT ||
        eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (this.screen.type === 'todoList') {
        await this.todoListScrolled(eventType)
      } else if (this.screen.type === 'todoRead') {
        if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
          this.todoReadPage = Math.max(0, this.todoReadPage - 1)
        } else {
          this.todoReadPage++
        }
        await this.render()
      }
      return
    }
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      // In standby, double-click always wakes (no matter what screen we're on)
      if (this.standbyMode) {
        this.standbyMode = false
        this.restartIdleTimer()
        await this.render()
        return
      }
      if (this.screen.type === 'home') {
        // Manual toggle into standby from home
        this.standbyMode = true
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
        await this.render()
        return
      }
      await this.goBack()
      return
    }
    // In thin mode only double click is active
    if (this.standbyMode) return
    if (eventType !== OsEventTypeList.CLICK_EVENT) return

    this.eventBusy = true
    try {
      switch (this.screen.type) {
        case 'home':      await this.homeSelect(idx);       break
        case 'favorites': await this.favoriteSelect(idx);  break
        case 'rooms':     await this.roomSelect(idx);      break
        case 'room':      await this.roomEntitySelect(idx); break
        case 'submenu':   await this.submenuSelect(idx);  break
        case 'confirm':   await this.confirmSelect(idx);  break
        case 'result':
        case 'loading':   await this.goBack();            break
        case 'todoLists': await this.todoListsSelect(idx); break
        case 'todoList':  await this.todoItemSelect(idx);  break
        case 'todoDetail': await this.todoDetailSelect(idx); break
        case 'todoRead': break // double-tap to go back, no click action
        case 'todoDeleteConfirm': await this.todoDeleteConfirmSelect(idx); break
      }
    } finally {
      this.eventBusy = false
    }
  }

  private async entitySelect(entityId: string) {
    const entity = this.ha.getEntity(entityId)
    const domain = entityId.split('.')[0]
    const subItems = buildSubItems(entityId, entity)

    // Scenes and scripts run immediately — no confirm needed
    if (domain === 'scene' || domain === 'script') {
      const { action, serviceCall } = defaultServiceCall(entityId, entity?.state ?? 'unknown')
      const success = await this.ha.callServiceWithData(serviceCall.domain, serviceCall.service, serviceCall.entityId, serviceCall.serviceData)
      if (success) this.addToRecent(entityId)
      this.push({ type: 'result', entityId, success, action })
      await this.render()
      this.resultTimer = setTimeout(() => {
        if (this.screenStack[this.screenStack.length - 1]?.type === 'result') this.screenStack.pop()
        this.postActionNavigate().catch(console.error)
      }, 2000)
      return
    }

    if (subItems !== null) {
      this.push({ type: 'submenu', entityId, items: subItems })
    } else {
      const { action, serviceCall } = defaultServiceCall(entityId, entity?.state ?? 'unknown')
      this.push({ type: 'confirm', entityId, action, serviceCall })
    }
    await this.render()
  }

  private async openLists() {
    const enabled = this.ha.getTodoEntities().filter(e => this.enabledTodoLists.includes(e.entity_id))
    if (enabled.length === 0) {
      this.push({ type: 'todoLists' })
      await this.render()
      return
    }
    if (enabled.length === 1) {
      const entityId = enabled[0].entity_id
      const cacheWarm = this.todoEntityId === entityId && this.todoSortedItems !== null
      if (!cacheWarm) {
        // Cache cold: fetch inline (still in event chain for first render)
        this.todoSortedItems = null
        this.todoEntityId = entityId
        this.todoSelectedIdx = 0
        this.push({ type: 'todoList', entityId })
        await this.render()  // shows Loading... — must stay in event chain
        try {
          const items = await Promise.race([
            this.ha.getTodoItems(entityId),
            new Promise<import('./ha-client').TodoItem[]>(resolve => setTimeout(() => resolve([]), 8000)),
          ])
          const pending = items.filter(i => !i.done)
          const done = items.filter(i => i.done)
          this.todoSortedItems = [...pending, ...done].slice(0, 20)
        } catch { this.todoSortedItems = [] }
        // Note: render after await won't update glasses display — prefetch prevents this path
      } else {
        // Cache warm: render immediately with real data — no Loading...
        this.todoSelectedIdx = 0
        this.push({ type: 'todoList', entityId })
        await this.render()
      }
      return
    }
    this.push({ type: 'todoLists' })
    await this.render()
  }

  private async homeSelect(idx: number) {
    const hasLists = this.enabledTodoLists.length > 0
    const listsIdx = hasLists ? 2 : -1
    const recentStart = hasLists ? 3 : 2
    if (idx === 0) { this.push({ type: 'favorites' }); await this.render() }
    else if (idx === 1) { this.push({ type: 'rooms' }); await this.render() }
    else if (idx === listsIdx) { await this.openLists() }
    else {
      const recent = getConfig().recentlyUsed
      const recentIdx = idx - recentStart
      if (recentIdx >= 0 && recentIdx < recent.length) await this.entitySelect(recent[recentIdx])
    }
  }

  private async favoriteSelect(idx: number) {
    if (idx >= this.favorites.length) return
    await this.entitySelect(this.favorites[idx].entity_id)
  }

  private async roomSelect(idx: number) {
    const roomNames = this.sortedRoomNames
    if (idx >= roomNames.length) return
    const name = roomNames[idx]
    this.addToRecentRooms(name)
    this.push({ type: 'room', name, entityIds: this.rooms.get(name)! })
    await this.render()
  }

  private async roomEntitySelect(idx: number) {
    if (this.screen.type !== 'room') return
    if (idx >= this.screen.entityIds.length) return
    await this.entitySelect(this.screen.entityIds[idx])
  }

  private async submenuSelect(idx: number) {
    if (this.screen.type !== 'submenu') return
    const { items } = this.screen
    if (idx >= items.length) return
    const item = items[idx]
    this.push({ type: 'confirm', entityId: item.serviceCall.entityId, action: item.label, serviceCall: item.serviceCall })
    await this.render()
  }

  private async confirmSelect(idx: number) {
    if (this.screen.type !== 'confirm') return
    if (idx === 0) { await this.goBack(); return }
    if (idx === 2) { await this.toggleFavourite(this.screen.entityId); return }
    await this.confirmExecute()
  }

  private async toggleFavourite(entityId: string) {
    const config = getConfig()
    const isFav = this.isFavourite(entityId)
    if (isFav) {
      saveConfig({ favorites: config.favorites.filter(f => f.entity_id !== entityId) })
    } else {
      if (config.favorites.length < 8) {
        saveConfig({ favorites: [...config.favorites, { entity_id: entityId, label: this.entityName(entityId) }] })
      }
    }
    const action = isFav ? 'Removed from Favourites' : 'Added to Favourites'
    this.screenStack.pop() // remove confirm
    this.push({ type: 'result', entityId, success: true, action })
    await this.render()
    this.resultTimer = setTimeout(() => {
      if (this.screenStack[this.screenStack.length - 1]?.type === 'result') this.screenStack.pop()
      this.postActionNavigate().catch(console.error)
    }, 2000)
  }

  private async postActionNavigate() {
    const dest = getConfig().postActionDestination ?? 'back'
    if (dest === 'home') {
      this.screenStack = [{ type: 'home' }]
      this.standbyMode = false
    } else if (dest === 'standby') {
      this.screenStack = [{ type: 'home' }]
      this.standbyMode = true
    }
    // 'back' — render whatever remains on the stack
    await this.render()
  }

  private async confirmExecute() {
    if (this.screen.type !== 'confirm') return
    const { entityId, action, serviceCall } = this.screen
    const success = await this.ha.callServiceWithData(
      serviceCall.domain,
      serviceCall.service,
      serviceCall.entityId,
      serviceCall.serviceData
    )
    if (success) this.addToRecent(entityId)
    this.screenStack.pop() // remove confirm
    this.push({ type: 'result', entityId, success, action })
    await this.render()
    this.resultTimer = setTimeout(() => {
      if (this.screenStack[this.screenStack.length - 1]?.type === 'result') this.screenStack.pop()
      this.postActionNavigate().catch(console.error)
    }, 2000)
  }

  private stopTodoDescScroll() {
    // No-op — description auto-scroll not implemented in this version
  }

  private async todoListScrolled(eventType: OsEventTypeList) {
    if (this.screen.type !== 'todoList') return
    const sorted = this.todoSortedItems
    if (!sorted || sorted.length === 0) return
    const total = sorted.length
    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (this.todoSelectedIdx === 0) {
        // Already at top — pull-to-refresh
        await this.refreshTodoList()
        return
      }
      this.todoSelectedIdx = Math.max(0, this.todoSelectedIdx - 1)
    } else {
      this.todoSelectedIdx = Math.min(total - 1, this.todoSelectedIdx + 1)
    }
    const item = sorted[this.todoSelectedIdx]
    const footerText = item
      ? `${item.done ? '\u25cf' : '\u25cb'} ${this.truncate(item.summary, 28)}${item.due ? '  ' + this.formatTodoDue(item.due) : ''}`
      : ''
    await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 3,
      containerName: 'footer',
      content: footerText,
    }))
  }

  private async refreshTodoList() {
    if (this.screen.type !== 'todoList') return
    const { entityId } = this.screen
    await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: 1, containerName: 'header', content: 'Refreshing...',
    }))
    try {
      const items = await Promise.race([
        this.ha.getTodoItems(entityId),
        new Promise<import('./ha-client').TodoItem[]>(resolve => setTimeout(() => resolve([]), 8000)),
      ])
      const pending = items.filter(i => !i.done)
      const done = items.filter(i => i.done)
      this.todoSortedItems = [...pending, ...done].slice(0, 20)
      this.todoEntityId = entityId
      this.todoSelectedIdx = 0
      const name = (this.ha.getEntity(entityId)?.attributes?.friendly_name as string) || entityId.split('.').pop() || ''
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1, containerName: 'header',
        content: `${name}  ${done.length}/${pending.length + done.length} done`,
      }))
    } catch {
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 1, containerName: 'header', content: 'Refresh failed',
      }))
    }
  }

  private async goBack() {
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null }
    this.stopTodoDescScroll()
    if (this.screenStack.length > 1) this.screenStack.pop()
    await this.render()
  }

  // --- Helpers ---

  private entityName(entityId: string): string {
    const custom = getConfig().customNames[entityId]
    if (custom) return custom
    const entity = this.ha.getEntity(entityId)
    return (entity?.attributes?.friendly_name as string) || entityId.split('.').pop() || entityId
  }

  private entityLabel(entityId: string): string {
    const entity = this.ha.getEntity(entityId)
    const state = entity?.state ?? '?'
    const domain = entityId.split('.')[0]
    const icon = domainIcon(domain, state)
    const name = this.entityName(entityId)
    const attrs = entity?.attributes ?? {}

    let detail = ''
    if (domain === 'climate' && state !== 'off' && state !== 'unavailable') {
      const tgt = attrs.temperature as number | undefined
      const fan = attrs.fan_mode as string | undefined
      const parts = [state.toUpperCase()]
      if (tgt != null) parts.push(`${tgt}\u00B0`)
      if (fan) parts.push(fan)
      detail = parts.join(' ')
    } else if (state === 'on' || state === 'open' || state === 'unlocked') {
      if (domain === 'light' && attrs.brightness != null) {
        const pct = Math.round((attrs.brightness as number) / 255 * 100)
        detail = `${pct}%`
      } else if (domain === 'cover' && attrs.current_position != null) {
        detail = `${attrs.current_position}%`
      } else if (domain === 'fan' && attrs.percentage != null) {
        detail = `${attrs.percentage}%`
      } else {
        detail = state.toUpperCase()
      }
    }

    return detail ? `${icon} ${name} ${ARROW_R} ${detail}` : `${icon} ${name}`
  }

  private countStates(entityIds: string[]): { on: number; off: number; total: number } {
    const offStates = new Set(['off', 'closed', 'locked', 'idle', 'standby', 'unavailable', 'unknown', 'disarmed', ''])
    let on = 0
    for (const id of entityIds) {
      const s = this.ha.getEntity(id)?.state ?? ''
      if (!offStates.has(s)) on++
    }
    return { on, off: entityIds.length - on, total: entityIds.length }
  }

  private addToRecent(entityId: string) {
    const config = getConfig()
    const recent = [entityId, ...config.recentlyUsed.filter(id => id !== entityId)].slice(0, 8)
    saveConfig({ recentlyUsed: recent })
  }

  private addToRecentRooms(roomName: string) {
    const config = getConfig()
    const recent = [roomName, ...(config.recentlyUsedRooms ?? []).filter(n => n !== roomName)].slice(0, 20)
    saveConfig({ recentlyUsedRooms: recent })
  }

  private getSortedRoomNames(): string[] {
    const allNames = [...this.rooms.keys()]
    if (this.roomListSortMode === 'recent') {
      const recent = getConfig().recentlyUsedRooms ?? []
      if (recent.length === 0) return allNames
      return [...allNames].sort((a, b) => {
        const ai = recent.indexOf(a), bi = recent.indexOf(b)
        if (ai === -1 && bi === -1) return a.localeCompare(b)
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    }
    if (this.roomOrder.length === 0) return allNames
    return [...allNames].sort((a, b) => {
      const ai = this.roomOrder.indexOf(a), bi = this.roomOrder.indexOf(b)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }

  private sortRoomEntities(roomName: string, entityIds: string[]): string[] {
    const roomMode = this.roomSortMode.get(roomName) ?? 'custom'
    if (roomMode === 'recent') {
      const recent = getConfig().recentlyUsed
      if (recent.length === 0) return entityIds
      return [...entityIds].sort((a, b) => {
        const ai = recent.indexOf(a), bi = recent.indexOf(b)
        if (ai === -1 && bi === -1) return this.entityName(a).localeCompare(this.entityName(b))
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    }
    // 'custom' — defer to statusPanelSort for ordering
    return this.sortStatusEntities(entityIds)
  }

  private sortStatusEntities(entityIds: string[]): string[] {
    const mode = getConfig().statusPanelSort ?? 'status'
    switch (mode) {
      case 'status': {
        const offStates = new Set(['off', 'closed', 'locked', 'idle', 'standby', 'unavailable', 'unknown', 'disarmed', ''])
        const isActive = (state: string) => !offStates.has(state)
        return [...entityIds].sort((a, b) => {
          const sa = this.ha.getEntity(a)?.state ?? ''
          const sb = this.ha.getEntity(b)?.state ?? ''
          const aOn = isActive(sa) ? 0 : 1
          const bOn = isActive(sb) ? 0 : 1
          if (aOn !== bOn) return aOn - bOn
          return this.entityName(a).localeCompare(this.entityName(b))
        })
      }
      case 'name':
        return [...entityIds].sort((a, b) =>
          this.entityName(a).localeCompare(this.entityName(b))
        )
      case 'recent': {
        const recent = getConfig().recentlyUsed
        if (recent.length === 0) return entityIds
        return [...entityIds].sort((a, b) => {
          const ai = recent.indexOf(a), bi = recent.indexOf(b)
          if (ai === -1 && bi === -1) return this.entityName(a).localeCompare(this.entityName(b))
          if (ai === -1) return 1
          if (bi === -1) return -1
          return ai - bi
        })
      }
      case 'custom':
      default:
        return entityIds
    }
  }
}

type Screen =
  | { type: 'home' }
  | { type: 'favorites' }
  | { type: 'rooms' }
  | { type: 'room'; name: string; entityIds: string[] }
  | { type: 'submenu'; entityId: string; items: SubItem[] }
  | { type: 'confirm'; entityId: string; action: string; serviceCall: ServiceCall }
  | { type: 'result'; entityId: string; success: boolean; action: string }
  | { type: 'loading'; message: string }
  | { type: 'todoLists' }
  | { type: 'todoList'; entityId: string }
  | { type: 'todoDetail'; entityId: string; itemUid: string }
  | { type: 'todoRead'; text: string; title: string }
  | { type: 'todoDeleteConfirm'; entityId: string; itemUid: string; summary: string }
