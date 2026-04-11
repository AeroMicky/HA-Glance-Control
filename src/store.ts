import { EvenAppBridge } from '@evenrealities/even_hub_sdk'

export interface FavoriteConfig {
  entity_id: string
  label: string
}

export interface SensorSlot {
  entity_id: string
  label: string
  unit?: string
  icon?: string
  showBar?: boolean
  showValue?: boolean  // when false and showBar is true, only bar is shown
  divisor?: number     // divide raw value by this (e.g. 1000 for W→kW)
  unitOverride?: string // display this unit instead of HA's unit_of_measurement
  condition?: { operator: '>' | '<' | '>=' | '<=' | '==' | '!=', value: string }
  _savedLabel?: string // preserved label when user toggles hide label
}

// Legacy types — kept for migration
export interface DashboardSlot {
  entity_id: string
  label: string
  unit: string
}

export interface EnergySlot {
  entity_id: string
  label: string
  icon?: string
  showBar?: boolean
}

export interface EnergyMonitor {
  battery_level?: string
  battery_power?: string
  time_remaining?: string
  ev_charging_amps?: string
}

export interface ClockConfig {
  show: boolean
  format: '12h' | '24h'
  showDate?: boolean
}

export interface AppConfig {
  ha_url: string
  ha_token: string
  favorites: FavoriteConfig[]
  rooms: Record<string, string[]>
  roomOrder: string[]
  roomListSortMode: 'custom' | 'recent'
  roomSortMode: Record<string, 'custom' | 'recent'>
  statusPanelSort: 'status' | 'name' | 'custom' | 'recent'
  postActionDestination: 'back' | 'home' | 'standby'
  headerSensors: SensorSlot[]
  footerSensors: SensorSlot[]
  clock: ClockConfig
  sensorScrollMode: 'paginate' | 'scroll'
  sensorPaginateInterval: number  // seconds between page rotations
  recentlyUsed: string[]
  recentlyUsedRooms: string[]
  customNames: Record<string, string>
  customIcons: Record<string, string>
  enabledTodoLists: string[]  // entity_ids of enabled todo lists
  // Legacy — kept for migration
  dashboard?: DashboardSlot[]
  energySlots?: EnergySlot[]
  energy?: EnergyMonitor
}

const STORAGE_KEY = 'ha-g2-config'

const DEFAULT_CONFIG: AppConfig = {
  ha_url: '',
  ha_token: '',
  favorites: [],
  rooms: {},
  roomOrder: [],
  roomListSortMode: 'custom',
  roomSortMode: {},
  statusPanelSort: 'status' as const,
  postActionDestination: 'back' as const,
  headerSensors: [],
  footerSensors: [],
  clock: { show: true, format: '24h' as const },
  sensorScrollMode: 'paginate' as const,
  sensorPaginateInterval: 4,
  recentlyUsed: [],
  recentlyUsedRooms: [],
  customNames: {},
  customIcons: {},
  enabledTodoLists: [],
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
    if (raw) {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
      // Migrate legacy data
      if (config.headerSensors.length === 0) {
        // Migrate energySlots -> headerSensors
        if (config.energySlots && config.energySlots.length > 0) {
          config.headerSensors = config.energySlots.map(s => ({ ...s, unit: '' }))
        }
        // Migrate legacy energy -> headerSensors
        else if (config.energy) {
          const e = config.energy
          const slots: SensorSlot[] = []
          if (e.battery_level) slots.push({ entity_id: e.battery_level, label: config.customNames[e.battery_level] || 'Battery', icon: 'battery', showBar: true })
          if (e.battery_power) slots.push({ entity_id: e.battery_power, label: config.customNames[e.battery_power] || 'Power', icon: 'bolt' })
          if (e.time_remaining) slots.push({ entity_id: e.time_remaining, label: config.customNames[e.time_remaining] || 'Time', icon: 'timer' })
          if (e.ev_charging_amps) slots.push({ entity_id: e.ev_charging_amps, label: config.customNames[e.ev_charging_amps] || 'EV', icon: 'bolt' })
          config.headerSensors = slots
        }
      }
      if (config.footerSensors.length === 0 && config.dashboard && config.dashboard.length > 0) {
        config.footerSensors = config.dashboard.map(s => ({
          entity_id: s.entity_id,
          label: s.label,
          unit: s.unit,
          icon: config.customIcons[s.entity_id],
        }))
      }
      // Clean up legacy
      delete config.energy
      delete config.energySlots
      delete config.dashboard
    }
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
