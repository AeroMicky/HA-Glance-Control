import { waitForEvenAppBridge, EvenAppBridge, DeviceConnectType } from '@evenrealities/even_hub_sdk'
import { HAClient } from './ha-client'
import { UI } from './ui'
import { PhoneUI } from './phone-ui'
import { loadConfig, getConfig, onConfigChanged } from './store'
import './style.css'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), ms)
    ),
  ])
}

let bridge: EvenAppBridge | null = null

async function main() {
  const root = document.createElement('div')
  root.id = 'phone-root'
  document.body.appendChild(root)

  try {
    bridge = await withTimeout(waitForEvenAppBridge(), 3000)
    console.log('[Main] Bridge ready')
  } catch {
    console.log('[Main] No bridge, phone-only mode')
  }

  let glassesUI: UI | null = null
  let activeHA: HAClient | null = null

  async function tryConnectGlasses(ha: HAClient) {
    if (!bridge) return
    glassesUI = new UI(ha, bridge)
    applyConfig(glassesUI)
    glassesUI.start()
  }

  const phoneUI = new PhoneUI(root, (ha: HAClient) => {
    activeHA = ha
    tryConnectGlasses(ha)
  })

  const config = await loadConfig()

  if (config.ha_url && config.ha_token) {
    try {
      const ha = new HAClient(config.ha_url, config.ha_token)
      await ha.connect()
      activeHA = ha
      phoneUI.setHA(ha)
      tryConnectGlasses(ha)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      phoneUI.setConnectError(msg)
      phoneUI.render()
    }
  } else {
    phoneUI.render()
  }

  // Re-render glasses when device reconnects
  if (bridge) {
    bridge.onDeviceStatusChanged((status) => {
      console.log('[Main] Device status:', status.connectType)
      if (status.connectType === DeviceConnectType.Connected && glassesUI) {
        glassesUI.render()
      }
    })

    // Log launch source — glassesMenu = launched via ring
    bridge.onLaunchSource((source) => {
      console.log('[Main] Launch source:', source)
    })
  }

  onConfigChanged(() => {
    if (glassesUI) applyConfig(glassesUI)
  })
}

function applyConfig(ui: UI) {
  const config = getConfig()
  ui.configure({
    favorites: config.favorites,
    headerSensors: config.headerSensors,
    footerSensors: config.footerSensors,
    rooms: config.rooms,
    roomOrder: config.roomOrder,
    roomListSortMode: config.roomListSortMode,
    roomSortMode: config.roomSortMode,
  })
}

main().catch(console.error)
