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

  // Shared channel for cross-context control in prototype testing (phone
  // browser + simulator). Pass the same instance to phoneUI so the sender's
  // tab does not receive its own messages.
  let controlChannel: BroadcastChannel | null = null
  try { controlChannel = new BroadcastChannel('ha-plugin-control') } catch { /* unsupported */ }

  const phoneUI = new PhoneUI(root, (ha: HAClient) => {
    activeHA = ha
    ha.onConnectionChange((connected) => phoneUI.setConnected(connected))
    tryConnectGlasses(ha)
  }, controlChannel)

  const config = await loadConfig()

  if (config.ha_url && config.ha_token) {
    try {
      const ha = new HAClient(config.ha_url, config.ha_token)
      await ha.connect()
      activeHA = ha
      phoneUI.setHA(ha)
      // Reflect HA connection state in the phone UI (Home pill, header badge).
      ha.onConnectionChange((connected) => phoneUI.setConnected(connected))
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
    let wasDisconnected = false
    bridge.onDeviceStatusChanged((status) => {
      console.log('[Main] Device status:', status.connectType)
      if (status.connectType === DeviceConnectType.Connected && glassesUI) {
        // If we just came back from a disconnect, glasses dropped our page
        // containers while out of range — a plain render() would call
        // rebuildPageContainer against missing IDs and silently no-op.
        // Full reset forces createStartUpPageContainer instead.
        if (wasDisconnected) {
          wasDisconnected = false
          glassesUI.resetForReconnect().catch(console.error)
        } else {
          glassesUI.render().catch(console.error)
        }
      } else if (status.connectType !== DeviceConnectType.Connected) {
        wasDisconnected = true
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

  // Cross-context control: phone UI can ask sibling contexts (e.g. the
  // simulator running in a separate tab during prototype testing) to drop or
  // refresh their HA connection. Messages never loop back to the sending tab
  // because phoneUI and this listener share the same channel instance.
  controlChannel?.addEventListener('message', (ev) => {
    if (ev.data === 'disconnect' && activeHA) {
      try { activeHA.disconnect() } catch { /* ignore */ }
    } else if (ev.data === 'reconnect') {
      // Simplest reliable path: reload so main() re-runs and creates a fresh
      // HAClient from the current config. Heavy, but prototype-only.
      location.reload()
    }
  })
}

function applyConfig(ui: UI) {
  const config = getConfig()
  const disabled = new Set(config.disabledRooms ?? [])
  const enabledRooms: Record<string, string[]> = {}
  for (const [name, ids] of Object.entries(config.rooms)) {
    if (!disabled.has(name)) enabledRooms[name] = ids
  }
  ui.configure({
    favorites: config.favorites,
    headerSensors: config.headerSensors,
    footerSensors: config.footerSensors,
    rooms: enabledRooms,
    roomOrder: (config.roomOrder ?? []).filter(n => !disabled.has(n)),
    roomListSortMode: config.roomListSortMode,
    roomSortMode: config.roomSortMode,
    enabledTodoLists: config.enabledTodoLists,
    autoStandbySeconds: config.autoStandbySeconds,
  })
}

main().catch(console.error)
