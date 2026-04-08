import { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export interface FavoriteConfig {
  entity_id: string
  label: string
}

export interface DashboardSlot {
  entity_id: string
  label: string
  unit: string
}

export interface AppConfig {
  ha_url: string
  ha_token: string
  favorites: FavoriteConfig[]
  rooms: Record<string, string[]>
  dashboard: DashboardSlot[]
}

const STORAGE_KEY = 'ha-g2-config'

const DEFAULT_CONFIG: AppConfig = {
  ha_url: '',
  ha_token: '',
  favorites: [],
  rooms: {},
  dashboard: [],
}

type ConfigListener = (config: AppConfig) => void

let config: AppConfig = DEFAULT_CONFIG
const listeners: ConfigListener[] = []

async function bridgeGet(key: string): Promise<string | null> {
  try {
    const bridge = EvenAppBridge.getInstance()
    if (bridge) {
      const val = await bridge.getLocalStorage(key)
      if (val) return val
    }
  } catch { /* bridge not available */ }
  return null
}

async function bridgeSet(key: string, value: string): Promise<void> {
  try {
    const bridge = EvenAppBridge.getInstance()
    if (bridge) await bridge.setLocalStorage(key, value)
  } catch { /* bridge not available */ }
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    // Try native bridge storage first (persists across WebView restarts)
    const raw = await bridgeGet(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY)
    if (raw) config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
  } catch {
    config = { ...DEFAULT_CONFIG }
  }
  return config
}

export function saveConfig(update: Partial<AppConfig>) {
  config = { ...config, ...update }
  const json = JSON.stringify(config)
  localStorage.setItem(STORAGE_KEY, json)
  bridgeSet(STORAGE_KEY, json)
  listeners.forEach(cb => cb(config))
}

export function getConfig(): AppConfig {
  return config
}

export function onConfigChanged(cb: ConfigListener) {
  listeners.push(cb)
}
