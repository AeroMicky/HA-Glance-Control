import { waitForEvenAppBridge, EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { HAClient } from './ha-client'
import { UI } from './ui'
import { PhoneUI } from './phone-ui'
import { loadConfig, onConfigChanged } from './store'
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

  // Initialize bridge first so storage is available
  try {
    bridge = await withTimeout(waitForEvenAppBridge(), 3000)
    console.log('[Main] Bridge ready')
  } catch {
    console.log('[Main] No bridge, phone-only mode')
  }

  let glassesUI: UI | null = null

  function tryConnectGlasses(ha: HAClient) {
    if (!bridge) return
    glassesUI = new UI(ha, bridge)
    applyConfig(glassesUI)
    glassesUI.start()
  }

  const phoneUI = new PhoneUI(root, (ha: HAClient) => {
    tryConnectGlasses(ha)
  })

  const config = await loadConfig()

  if (config.ha_url && config.ha_token) {
    try {
      const ha = new HAClient(config.ha_url, config.ha_token)
      await ha.connect()
      phoneUI.setHA(ha)
      tryConnectGlasses(ha)
    } catch {
      phoneUI.render()
    }
  } else {
    phoneUI.render()
  }

  onConfigChanged(() => {
    if (glassesUI) applyConfig(glassesUI)
  })
}

async function applyConfig(ui: UI) {
  const config = await loadConfig()
  ui.configure({
    favorites: config.favorites,
    dashboard: config.dashboard,
    rooms: config.rooms,
  })
}

main().catch(console.error)
