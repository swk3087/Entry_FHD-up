export interface ExtensionSettings {
  extensionEnabled: boolean
  qualityEnabled: boolean
  qualityBoost: number
  autoRecordEnabled: boolean
  includeAudio: boolean
}

export const SETTINGS_STORAGE_KEY = 'entryFhdSettings'

const MIN_QUALITY_BOOST = 1
const MAX_QUALITY_BOOST = 2

export const DEFAULT_SETTINGS: ExtensionSettings = {
  extensionEnabled: true,
  qualityEnabled: true,
  qualityBoost: 1.5,
  autoRecordEnabled: false,
  includeAudio: true,
}

export function clampQualityBoost(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  const asNumber = typeof parsed === 'number' && Number.isFinite(parsed)
    ? parsed
    : DEFAULT_SETTINGS.qualityBoost
  return Math.min(MAX_QUALITY_BOOST, Math.max(MIN_QUALITY_BOOST, asNumber))
}

export function normalizeSettings(raw?: Partial<ExtensionSettings>): ExtensionSettings {
  return {
    extensionEnabled: raw?.extensionEnabled ?? DEFAULT_SETTINGS.extensionEnabled,
    qualityEnabled: raw?.qualityEnabled ?? DEFAULT_SETTINGS.qualityEnabled,
    qualityBoost: clampQualityBoost(raw?.qualityBoost),
    autoRecordEnabled: raw?.autoRecordEnabled ?? DEFAULT_SETTINGS.autoRecordEnabled,
    includeAudio: raw?.includeAudio ?? DEFAULT_SETTINGS.includeAudio,
  }
}

export async function loadSettings(): Promise<ExtensionSettings> {
  return await new Promise(resolve => {
    if (!chrome?.storage?.local) {
      resolve(DEFAULT_SETTINGS)
      return
    }

    chrome.storage.local.get([SETTINGS_STORAGE_KEY], values => {
      resolve(normalizeSettings(values?.[SETTINGS_STORAGE_KEY] as Partial<ExtensionSettings> | undefined))
    })
  })
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await new Promise<void>(resolve => {
    if (!chrome?.storage?.local) {
      resolve()
      return
    }

    chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: normalizeSettings(settings),
    }, () => resolve())
  })
}

export function observeSettings(handler: (settings: ExtensionSettings) => void): () => void {
  if (!chrome?.storage?.onChanged) return () => {}

  const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, areaName) => {
    if (areaName !== 'local') return
    if (!changes[SETTINGS_STORAGE_KEY]) return
    handler(normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue as Partial<ExtensionSettings> | undefined))
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
