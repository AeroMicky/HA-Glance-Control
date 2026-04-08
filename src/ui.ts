import {
  EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerProperty,
  OsEventTypeList,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { HAClient } from './ha-client'
import { FavoriteConfig, DashboardSlot } from './store'

const W = 576
const H = 288
const LIST_W = 320
const STATUS_W = 248
const STATUS_X = 328

type Screen =
  | { type: 'menu' }
  | { type: 'favorites' }
  | { type: 'rooms' }
  | { type: 'room'; name: string; entityIds: string[] }
  | { type: 'confirm'; entityId: string; action: string }
  | { type: 'result'; entityId: string; success: boolean }
  | { type: 'dashboard' }
  | { type: 'loading'; message: string }

function resolveEventType(event: EvenHubEvent): OsEventTypeList | undefined {
  const raw =
    event.listEvent?.eventType ??
    event.textEvent?.eventType ??
    event.sysEvent?.eventType
  if (typeof raw === 'number' && raw >= 0 && raw <= 3) return raw
  if (typeof raw === 'string') {
    const v = raw.toUpperCase()
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

export class UI {
  private bridge: EvenAppBridge
  private ha: HAClient
  private screen: Screen = { type: 'menu' }
  private startupRendered = false
  private resultTimer: ReturnType<typeof setTimeout> | null = null
  private favorites: FavoriteConfig[] = []
  private dashboard: DashboardSlot[] = []
  private rooms = new Map<string, string[]>()

  constructor(ha: HAClient, bridge: EvenAppBridge) {
    this.ha = ha
    this.bridge = bridge
  }

  configure(opts: { favorites: FavoriteConfig[]; dashboard: DashboardSlot[]; rooms: Record<string, string[]> }) {
    this.favorites = opts.favorites
    this.dashboard = opts.dashboard
    this.rooms.clear()
    for (const [name, ids] of Object.entries(opts.rooms)) {
      this.rooms.set(name, ids)
    }
  }

  async start() {
    this.bridge.onEvenHubEvent((event) => {
      const eventType = resolveEventType(event)
      if (eventType === undefined) return
      if (eventType === OsEventTypeList.SCROLL_TOP_EVENT ||
          eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return
      const idx = event.listEvent?.currentSelectItemIndex ?? 0
      this.handleEvent(eventType, idx)
    })
    this.ha.onStateChanged(() => this.refreshIfNeeded())
    await this.render()
  }

  private async rebuildPage(config: {
    containerTotalNum: number
    listObject?: ListContainerProperty[]
    textObject?: TextContainerProperty[]
  }) {
    if (!this.startupRendered) {
      await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer(config)
      )
      this.startupRendered = true
      return
    }
    await this.bridge.rebuildPageContainer(
      new RebuildPageContainer(config)
    )
  }

  private makeList(items: string[]): ListContainerProperty {
    return new ListContainerProperty({
      containerID: 1,
      containerName: 'list',
      xPosition: 0,
      yPosition: 0,
      width: LIST_W,
      height: H,
      borderWidth: 1,
      borderColor: 5,
      borderRadius: 4,
      paddingLength: 4,
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: items.length,
        itemWidth: LIST_W - 10,
        isItemSelectBorderEn: 1,
        itemName: items,
      }),
    })
  }

  private makeStatus(content: string): TextContainerProperty {
    return new TextContainerProperty({
      containerID: 2,
      containerName: 'status',
      content,
      xPosition: STATUS_X,
      yPosition: 0,
      width: STATUS_W,
      height: H,
      paddingLength: 4,
      isEventCapture: 0,
    })
  }

  private makeFullText(content: string): TextContainerProperty {
    return new TextContainerProperty({
      containerID: 1,
      containerName: 'text',
      content,
      xPosition: 0,
      yPosition: 0,
      width: W,
      height: H,
      paddingLength: 8,
      isEventCapture: 1,
    })
  }

  private entityLabel(entityId: string): string {
    const entity = this.ha.getEntity(entityId)
    const name = (entity?.attributes?.friendly_name as string) || entityId.split('.').pop() || entityId
    const state = entity?.state ?? '?'
    return `${name}  ${state.toUpperCase()}`
  }

  async render() {
    switch (this.screen.type) {
      case 'menu':
        await this.renderMenu()
        break
      case 'favorites':
        await this.renderFavorites()
        break
      case 'rooms':
        await this.renderRooms()
        break
      case 'room':
        await this.renderRoom()
        break
      case 'confirm':
        await this.renderConfirm()
        break
      case 'result':
        await this.renderResult()
        break
      case 'dashboard':
        await this.renderDashboard()
        break
      case 'loading':
        await this.renderLoading()
        break
    }
  }

  private async renderMenu() {
    const items = ['Favorites', 'Rooms', 'Dashboard']
    const status = [
      'HA Glasses',
      '',
      `${this.favorites.length} favorites`,
      `${this.rooms.size} rooms`,
      `${this.dashboard.length} sensors`,
    ].join('\n')
    await this.rebuildPage({
      containerTotalNum: 2,
      listObject: [this.makeList(items)],
      textObject: [this.makeStatus(status)],
    })
  }

  private async renderFavorites() {
    const items = ['< Back', ...this.favorites.map(f => this.entityLabel(f.entity_id))]
    const status = this.favorites.length > 0
      ? `${this.favorites.length} favorites\n\nTap to toggle`
      : 'No favorites\n\nAdd via phone'
    await this.rebuildPage({
      containerTotalNum: 2,
      listObject: [this.makeList(items)],
      textObject: [this.makeStatus(status)],
    })
  }

  private async renderRooms() {
    const roomNames = [...this.rooms.keys()]
    const items = ['< Back', ...roomNames.map(name => {
      const ids = this.rooms.get(name)!
      return `${name}  (${ids.length})`
    })]
    const status = `${roomNames.length} rooms\n\nTap to browse`
    await this.rebuildPage({
      containerTotalNum: 2,
      listObject: [this.makeList(items)],
      textObject: [this.makeStatus(status)],
    })
  }

  private async renderRoom() {
    if (this.screen.type !== 'room') return
    const { name, entityIds } = this.screen
    const items = ['< Back', ...entityIds.map(id => this.entityLabel(id))]
    const status = `${name}\n\n${entityIds.length} entities`
    await this.rebuildPage({
      containerTotalNum: 2,
      listObject: [this.makeList(items)],
      textObject: [this.makeStatus(status)],
    })
  }

  private async renderConfirm() {
    if (this.screen.type !== 'confirm') return
    const { entityId, action } = this.screen
    const entity = this.ha.getEntity(entityId)
    const name = (entity?.attributes?.friendly_name as string) || entityId
    const text = `${action}\n${name}?\n\nTap = Yes\nDouble-tap = Cancel`
    await this.rebuildPage({
      containerTotalNum: 1,
      textObject: [this.makeFullText(text)],
    })
  }

  private async renderResult() {
    if (this.screen.type !== 'result') return
    const { entityId, success } = this.screen
    const entity = this.ha.getEntity(entityId)
    const name = (entity?.attributes?.friendly_name as string) || entityId
    const state = entity?.state ?? '?'
    const text = success
      ? `OK\n\n${name}\n${state.toUpperCase()}`
      : `FAILED\n\n${name}`
    await this.rebuildPage({
      containerTotalNum: 1,
      textObject: [this.makeFullText(text)],
    })
  }

  private async renderDashboard() {
    if (this.dashboard.length === 0) {
      await this.rebuildPage({
        containerTotalNum: 1,
        textObject: [this.makeFullText('No sensors\n\nAdd via phone\n\nTap = Back')],
      })
      return
    }
    const lines = this.dashboard.map(slot => {
      const entity = this.ha.getEntity(slot.entity_id)
      const val = entity?.state ?? '?'
      return `${slot.label}: ${val} ${slot.unit}`
    })
    const text = lines.join('\n') + '\n\nTap = Back'
    await this.rebuildPage({
      containerTotalNum: 1,
      textObject: [this.makeFullText(text)],
    })
  }

  private async renderLoading() {
    if (this.screen.type !== 'loading') return
    await this.rebuildPage({
      containerTotalNum: 1,
      textObject: [this.makeFullText(this.screen.message)],
    })
  }

  private async handleEvent(eventType: OsEventTypeList, idx: number) {
    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      await this.goBack()
      return
    }
    if (eventType !== OsEventTypeList.CLICK_EVENT) return

    switch (this.screen.type) {
      case 'menu':
        await this.menuSelect(idx)
        break
      case 'favorites':
        if (idx === 0) { await this.goBack(); return }
        await this.favoriteSelect(idx - 1)
        break
      case 'rooms':
        if (idx === 0) { await this.goBack(); return }
        await this.roomSelect(idx - 1)
        break
      case 'room':
        if (idx === 0) { await this.goBack(); return }
        await this.roomEntitySelect(idx - 1)
        break
      case 'confirm':
        await this.confirmExecute()
        break
      case 'result':
      case 'dashboard':
      case 'loading':
        await this.goBack()
        break
    }
  }

  private async menuSelect(idx: number) {
    switch (idx) {
      case 0: this.screen = { type: 'favorites' }; break
      case 1: this.screen = { type: 'rooms' }; break
      case 2: this.screen = { type: 'dashboard' }; break
      default: return
    }
    await this.render()
  }

  private async favoriteSelect(idx: number) {
    if (idx >= this.favorites.length) return
    const fav = this.favorites[idx]
    const entity = this.ha.getEntity(fav.entity_id)
    const currentState = entity?.state ?? 'unknown'
    const action = currentState === 'on' ? 'Turn OFF' : 'Turn ON'
    this.screen = { type: 'confirm', entityId: fav.entity_id, action }
    await this.render()
  }

  private async roomSelect(idx: number) {
    const roomNames = [...this.rooms.keys()]
    if (idx >= roomNames.length) return
    const name = roomNames[idx]
    this.screen = { type: 'room', name, entityIds: this.rooms.get(name)! }
    await this.render()
  }

  private async roomEntitySelect(idx: number) {
    if (this.screen.type !== 'room') return
    if (idx >= this.screen.entityIds.length) return
    const entityId = this.screen.entityIds[idx]
    const entity = this.ha.getEntity(entityId)
    const currentState = entity?.state ?? 'unknown'
    const action = currentState === 'on' ? 'Turn OFF' : 'Turn ON'
    this.screen = { type: 'confirm', entityId, action }
    await this.render()
  }

  private async confirmExecute() {
    if (this.screen.type !== 'confirm') return
    const { entityId } = this.screen
    const entity = this.ha.getEntity(entityId)
    const name = (entity?.attributes?.friendly_name as string) || entityId
    this.screen = { type: 'loading', message: `Toggling ${name}...` }
    await this.render()
    const success = await this.ha.toggle(entityId)
    this.screen = { type: 'result', entityId, success }
    await this.render()
    this.resultTimer = setTimeout(() => {
      this.screen = { type: 'favorites' }
      this.render()
    }, 2000)
  }

  private async goBack() {
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null }
    switch (this.screen.type) {
      case 'favorites':
      case 'rooms':
      case 'dashboard':
        this.screen = { type: 'menu' }; break
      case 'room':
        this.screen = { type: 'rooms' }; break
      case 'confirm':
      case 'result':
      case 'loading':
        this.screen = { type: 'favorites' }; break
      case 'menu':
        return
    }
    await this.render()
  }

  private refreshIfNeeded() {
    if (this.screen.type === 'favorites' || this.screen.type === 'room' || this.screen.type === 'dashboard') {
      this.render()
    }
  }
}
