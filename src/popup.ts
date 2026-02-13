import {
  clampQualityBoost,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  loadSettings,
  saveSettings,
} from './settings'

interface PopupElements {
  extensionEnabled: HTMLInputElement
  qualityEnabled: HTMLInputElement
  qualityBoost: HTMLSelectElement
  autoRecordEnabled: HTMLInputElement
  includeAudio: HTMLInputElement
  saveState: HTMLElement
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Element not found: ${id}`)
  return element as T
}

function getPopupElements(): PopupElements {
  return {
    extensionEnabled: getElement<HTMLInputElement>('extensionEnabled'),
    qualityEnabled: getElement<HTMLInputElement>('qualityEnabled'),
    qualityBoost: getElement<HTMLSelectElement>('qualityBoost'),
    autoRecordEnabled: getElement<HTMLInputElement>('autoRecordEnabled'),
    includeAudio: getElement<HTMLInputElement>('includeAudio'),
    saveState: getElement<HTMLElement>('saveState'),
  }
}

function applySettingsToUi(elements: PopupElements, settings: ExtensionSettings): void {
  elements.extensionEnabled.checked = settings.extensionEnabled
  elements.qualityEnabled.checked = settings.qualityEnabled
  elements.qualityBoost.value = String(settings.qualityBoost)
  elements.autoRecordEnabled.checked = settings.autoRecordEnabled
  elements.includeAudio.checked = settings.includeAudio

  const qualityControlsDisabled = !settings.extensionEnabled || !settings.qualityEnabled
  elements.qualityEnabled.disabled = !settings.extensionEnabled
  elements.qualityBoost.disabled = qualityControlsDisabled
  elements.autoRecordEnabled.disabled = !settings.extensionEnabled
  elements.includeAudio.disabled = !settings.extensionEnabled || !settings.autoRecordEnabled
}

function readSettingsFromUi(elements: PopupElements): ExtensionSettings {
  return {
    extensionEnabled: elements.extensionEnabled.checked,
    qualityEnabled: elements.qualityEnabled.checked,
    qualityBoost: clampQualityBoost(elements.qualityBoost.value),
    autoRecordEnabled: elements.autoRecordEnabled.checked,
    includeAudio: elements.includeAudio.checked,
  }
}

function updateSaveState(elements: PopupElements, text: string): void {
  elements.saveState.textContent = text
}

async function initPopup(): Promise<void> {
  const elements = getPopupElements()
  const loaded = await loadSettings().catch(() => DEFAULT_SETTINGS)
  let currentSettings = loaded
  applySettingsToUi(elements, currentSettings)
  updateSaveState(elements, '')

  let saveTimer: number | undefined
  const saveFromUi = async (): Promise<void> => {
    const nextSettings = readSettingsFromUi(elements)
    currentSettings = nextSettings
    applySettingsToUi(elements, nextSettings)
    await saveSettings(nextSettings)
    updateSaveState(elements, 'Saved')
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => updateSaveState(elements, ''), 1200)
  }

  elements.extensionEnabled.addEventListener('change', () => { void saveFromUi() })
  elements.qualityEnabled.addEventListener('change', () => { void saveFromUi() })
  elements.qualityBoost.addEventListener('change', () => { void saveFromUi() })
  elements.autoRecordEnabled.addEventListener('change', () => { void saveFromUi() })
  elements.includeAudio.addEventListener('change', () => { void saveFromUi() })
}

document.addEventListener('DOMContentLoaded', () => {
  void initPopup()
})
