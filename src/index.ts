import {
  DEFAULT_SETTINGS,
  ExtensionSettings,
  loadSettings,
  observeSettings,
} from './settings'

declare global {
  var __REQUEST_ANIMATION_FRAME_ID: number | undefined
}

type RenderMode = 'webgl' | 'canvas'

interface EntryGlobal {
  engine: {
    isState(state: string): boolean
  }
  dispatchEvent(event: string, object: Entity): void
  type: string
  options: {
    useWebGL?: boolean
  }
  requestUpdate: boolean
  container: {
    selectObject(id: string): void
    objects_: {
      entity: {
        object: StageObject
      }
    }[]
  }
  stage?: Stage
}

interface Stage {
  updateObject(): void
  isEntitySelectable(): boolean
  update(): void
  handle: Handle
  variableContainer: {
    children: StageObject[]
  }
  isObjectClick: boolean
  inputField: InputField | null
  canvas: {
    update?(): void
    children: StageObject[]
    x: number
    y: number
    scaleX: number
    scaleY: number
    canvas: HTMLCanvasElement
  }
  _app: {
    render?(): void
    screen?: Resizable
    renderer?: {
      resize(width: number, height: number): void
      options: Resizable
    }
  }
}

interface InputField {
  _isHidden: boolean
  _x: number
  _y: number
  _padding: number
  getPixiView(): {
    scale: Settable
    position: Settable
  }
  x(data: number): void
  y(data: number): void
  width(data: number): void
  height(data: number): void
  padding(data: number): void
  borderWidth(data: number): void
  borderRadius(data: number): void
  fontSize(data: number): void
}

interface Settable {
  x: number
  y: number
  set(x?: number, y?: number): this
}

interface Resizable {
  width: number
  height: number
}

interface EntryObject {
  id: string
  getLock(): boolean
}

interface Entity {
  x: number
  y: number
  setX(data: number): void
  setY(data: number): void
  initCommand(): void
  parent: EntryObject
}

interface StageEvent {
  stageX: number
  stageY: number
}

interface StageObject {
  offsetX: number
  offsetY: number
  variable: {
    getWidth(): number
    getHeight(): number
    setWidth(data: number): void
    setHeight(data: number): void
    getX(): number
    setSlideCommandX(x: number): void
    isResizing?: boolean
    isAdjusting?: boolean
    slideBar_?: StageObject
    valueSetter_?: StageObject
    resizeHandle_?: StageObject
    scrollButton_?: StageObject
    setX(data: number): void
    setY(data: number): void
    updateView(): void
  }
  x: number
  y: number
  cursor: string
  children: StageObject[]
  resolution?: number
  parent: {
    x: number
    y: number
    cursor: string
  }
  offset?: {
    x: number
    y: number
  }
  on(event: string, handler: (event: StageEvent) => void): void
  removeAllListeners?(event: string): void
  removeAllEventListeners?(event: string): void
  entity: Entity
  _viewportPatchedMode?: string
}

interface Handle {
  getEventCoordinate(event: StageEvent): {
    x: number
    y: number
  }
}

const MAX_RENDER_WIDTH = 1920
const BASE_WIDTH = 640
const BASE_HEIGHT = 360
const PATCH_INTERVAL_MS = 300

const RECORDING_FPS = 60
const RECORDING_CHUNK_MS = 1000

const runtimeState = {
  settings: DEFAULT_SETTINGS,
  lastMode: '' as RenderMode | '',
  lastPatchAt: 0,
  lastObjectCount: 0,
  lastVariableCount: 0,
  lastResolution: 0,
  wasRunning: false,
}

function initializeSettings(): void {
  void loadSettings()
    .then(settings => {
      runtimeState.settings = settings
    })
    .catch(() => {
      runtimeState.settings = DEFAULT_SETTINGS
    })

  observeSettings(settings => {
    runtimeState.settings = settings
  })
}

class PageAudioCollector {
  private installed = false
  private readonly mirrorDestinationByContext = new WeakMap<BaseAudioContext, MediaStreamAudioDestinationNode>()
  private readonly mirroredNodes = new WeakMap<AudioNode, WeakSet<AudioNode>>()
  private readonly knownStreams = new Set<MediaStream>()
  private originalConnect?: typeof AudioNode.prototype.connect

  install(): void {
    if (this.installed || typeof AudioNode === 'undefined') return
    this.originalConnect = AudioNode.prototype.connect

    const collector = this
    AudioNode.prototype.connect = function patchedConnect(this: AudioNode, destinationNode: AudioNode | AudioParam, ...args: number[]): AudioNode {
      const connect = collector.originalConnect as unknown as (this: AudioNode, destination: AudioNode | AudioParam, ...rest: number[]) => AudioNode
      const result = connect.call(this, destinationNode, ...args)

      try {
        if (!(destinationNode instanceof AudioDestinationNode)) return result
        if (destinationNode.context !== this.context) return result

        const mirrorDestination = collector.getOrCreateMirror(destinationNode.context)
        if (!mirrorDestination) return result
        if (!collector.markMirrorConnection(this, mirrorDestination)) return result

        connect.call(this, mirrorDestination)
      } catch {
        // Best-effort patching only.
      }

      return result
    } as typeof AudioNode.prototype.connect

    this.installed = true
  }

  collectAudioStreams(documentRoot: Document): MediaStream[] {
    const collected: MediaStream[] = []
    const seenTrackIds = new Set<string>()

    for (const stream of this.knownStreams) {
      const liveTracks = stream.getAudioTracks().filter(track => track.readyState === 'live')
      if (liveTracks.length === 0) continue
      if (liveTracks.every(track => seenTrackIds.has(track.id))) continue
      liveTracks.forEach(track => seenTrackIds.add(track.id))
      collected.push(stream)
    }

    const mediaElements = Array.from(documentRoot.querySelectorAll('audio,video')) as Array<
      HTMLMediaElement & {
        captureStream?: () => MediaStream
        mozCaptureStream?: () => MediaStream
      }
    >

    for (const mediaElement of mediaElements) {
      const capture = mediaElement.captureStream || mediaElement.mozCaptureStream
      if (!capture) continue

      try {
        const stream = capture.call(mediaElement)
        const liveTracks = stream.getAudioTracks().filter(track => track.readyState === 'live')
        if (liveTracks.length === 0) continue
        if (liveTracks.every(track => seenTrackIds.has(track.id))) continue
        liveTracks.forEach(track => seenTrackIds.add(track.id))
        collected.push(stream)
      } catch {
        // Ignore media elements that deny capture.
      }
    }

    return collected
  }

  private getOrCreateMirror(context: BaseAudioContext): MediaStreamAudioDestinationNode | undefined {
    const cached = this.mirrorDestinationByContext.get(context)
    if (cached) return cached
    if (!(context instanceof AudioContext)) return undefined
    if (typeof context.createMediaStreamDestination !== 'function') return undefined

    const mirror = context.createMediaStreamDestination()
    this.mirrorDestinationByContext.set(context, mirror)
    this.knownStreams.add(mirror.stream)
    return mirror
  }

  private markMirrorConnection(sourceNode: AudioNode, mirrorNode: AudioNode): boolean {
    let connectedMirrors = this.mirroredNodes.get(sourceNode)
    if (!connectedMirrors) {
      connectedMirrors = new WeakSet<AudioNode>()
      this.mirroredNodes.set(sourceNode, connectedMirrors)
    }

    if (connectedMirrors.has(mirrorNode)) return false
    connectedMirrors.add(mirrorNode)
    return true
  }
}

interface MixedAudioResult {
  track?: MediaStreamTrack
  cleanup(): void
}

function mixAudioStreams(audioStreams: MediaStream[]): MixedAudioResult {
  if (audioStreams.length === 0 || typeof AudioContext === 'undefined') {
    return { cleanup() {} }
  }

  let mixContext: AudioContext | undefined
  try {
    mixContext = new AudioContext()
  } catch {
    return { cleanup() {} }
  }

  const destination = mixContext.createMediaStreamDestination()
  const sources: MediaStreamAudioSourceNode[] = []

  for (const stream of audioStreams) {
    const tracks = stream.getAudioTracks().filter(track => track.readyState === 'live')
    if (tracks.length === 0) continue

    try {
      const sourceNode = mixContext.createMediaStreamSource(new MediaStream(tracks))
      sourceNode.connect(destination)
      sources.push(sourceNode)
    } catch {
      // Ignore streams that cannot be mixed.
    }
  }

  void mixContext.resume().catch(() => {})

  const track = destination.stream.getAudioTracks()[0]
  return {
    track,
    cleanup: () => {
      for (const sourceNode of sources) {
        try {
          sourceNode.disconnect()
        } catch {
          // Ignore disconnection errors.
        }
      }
      try {
        destination.disconnect()
      } catch {
        // Ignore disconnection errors.
      }
      void mixContext?.close().catch(() => {})
    },
  }
}

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined

  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=opus',
    'video/webm',
  ]

  return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate))
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function saveRecordingBlob(blob: Blob, mimeType: string): void {
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
  const fileName = `entry-recording-${formatTimestamp(new Date())}.${extension}`
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.style.display = 'none'
  document.documentElement.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
}

class CanvasRecorder {
  private recorder?: MediaRecorder
  private outputStream?: MediaStream
  private chunks: Blob[] = []
  private saveOnStop = true
  private starting = false
  private cleanupMixedAudio?: () => void

  constructor(private readonly audioCollector: PageAudioCollector) {}

  isActive(): boolean {
    if (this.starting) return true
    if (!this.recorder) return false
    return this.recorder.state !== 'inactive'
  }

  async start(canvasElement: HTMLCanvasElement, includeAudio: boolean): Promise<void> {
    if (typeof MediaRecorder === 'undefined') return
    if (this.starting) return
    if (this.recorder && this.recorder.state !== 'inactive') return

    this.starting = true
    try {
      const outputStream = new MediaStream()
      const canvasStream = canvasElement.captureStream(RECORDING_FPS)
      canvasStream.getVideoTracks().forEach(track => outputStream.addTrack(track))

      const mixedAudio = includeAudio
        ? mixAudioStreams(this.audioCollector.collectAudioStreams(document))
        : { cleanup() {} }

      if (mixedAudio.track) {
        outputStream.addTrack(mixedAudio.track)
      }

      const preferredMimeType = pickRecorderMimeType()
      const recorder = preferredMimeType
        ? new MediaRecorder(outputStream, { mimeType: preferredMimeType })
        : new MediaRecorder(outputStream)

      this.recorder = recorder
      this.outputStream = outputStream
      this.cleanupMixedAudio = mixedAudio.cleanup
      this.chunks = []
      this.saveOnStop = true

      recorder.ondataavailable = event => {
        if (event.data.size > 0) this.chunks.push(event.data)
      }

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || preferredMimeType || 'video/webm'
        const shouldSave = this.saveOnStop
        const blob = this.chunks.length > 0
          ? new Blob(this.chunks, { type: mimeType })
          : undefined
        this.chunks = []
        this.releaseStreamResources()
        if (shouldSave && blob && blob.size > 0) {
          saveRecordingBlob(blob, mimeType)
        }
      }

      recorder.onerror = () => {
        this.chunks = []
        this.releaseStreamResources()
      }

      recorder.start(RECORDING_CHUNK_MS)
    } catch {
      this.chunks = []
      this.releaseStreamResources()
    } finally {
      this.starting = false
    }
  }

  stop(saveFile: boolean): void {
    if (!this.recorder) return
    this.saveOnStop = saveFile

    if (this.recorder.state === 'inactive') {
      this.releaseStreamResources()
      return
    }
    this.recorder.stop()
  }

  private releaseStreamResources(): void {
    if (this.outputStream) {
      this.outputStream.getTracks().forEach(track => track.stop())
    }
    this.outputStream = undefined

    if (this.cleanupMixedAudio) {
      this.cleanupMixedAudio()
    }
    this.cleanupMixedAudio = undefined
    this.recorder = undefined
  }
}

const pageAudioCollector = new PageAudioCollector()
pageAudioCollector.install()
const canvasRecorder = new CanvasRecorder(pageAudioCollector)
initializeSettings()

function getEntryGlobal(): EntryGlobal | undefined {
  const frameWindow = (document.querySelector('iframe.eaizycc0') as HTMLIFrameElement | null)?.contentWindow
  const hostWindow = (frameWindow || self) as Window & { Entry?: EntryGlobal }
  return hostWindow.Entry
}

function computeRenderSize(canvasElement: HTMLCanvasElement, qualityBoost: number): { width: number, height: number } {
  const cssWidth = Math.round(canvasElement.offsetWidth)
  if (cssWidth <= 0) return {
    width: Math.max(BASE_WIDTH, canvasElement.width || BASE_WIDTH),
    height: Math.max(BASE_HEIGHT, canvasElement.height || BASE_HEIGHT),
  }

  const width = Math.max(
    BASE_WIDTH,
    Math.min(
      MAX_RENDER_WIDTH,
      Math.round(cssWidth * Math.max(1, devicePixelRatio) * qualityBoost),
    ),
  )

  return { width, height: Math.round(width * 9 / 16) }
}

function resizeStage(stage: Stage, width: number, height: number): void {
  const { canvas } = stage
  const canvasElement = canvas.canvas
  if (canvasElement.width === width && canvasElement.height === height) return

  canvasElement.width = width
  canvasElement.height = height
  canvas.x = width / 2
  canvas.y = height / 2
  canvas.scaleX = width / 480
  canvas.scaleY = height / 270

  const { _app } = stage
  const { screen, renderer } = _app
  if (screen && renderer) {
    screen.width = width
    screen.height = height
    renderer.resize(width, height)
    renderer.options.width = width
    renderer.options.height = height
  }

  _app.render?.()
  canvas.update?.()
}

function updateTextResolution(rootObjects: StageObject[], resolution: number): void {
  const queue = [...rootObjects]
  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) continue
    if (current.resolution) current.resolution = resolution
    queue.push(...current.children)
  }
}

function updateInputField(entry: EntryGlobal, stage: Stage, width: number, height: number, useWebGL?: boolean): void {
  const { canvas } = stage
  const inputField = stage.inputField
  if (!inputField || inputField._isHidden || inputField._padding === width * 13 / 640) return

  inputField.x(Math.round(width * 3 / 128))
  inputField.y(Math.round(height * 55 / 72))
  inputField.width(Math.max(1, width * 13 / 16))
  inputField.height(Math.max(1, height / 15))
  inputField.padding(width * 13 / 640)
  inputField.borderWidth(width / 320)
  inputField.borderRadius(width / 64)
  inputField.fontSize(width / 32)

  if (useWebGL) {
    const view = inputField.getPixiView()
    view.scale.set(480 / width, 270 / height)
    view.position.set((inputField._x - canvas.x) / canvas.scaleX, (inputField._y - canvas.y) / canvas.scaleY)
  }

  entry.requestUpdate = true
  stage.update()
  entry.requestUpdate = false
}

function patchEntityObject(entry: EntryGlobal, stage: Stage, object: StageObject, mode: RenderMode): void {
  const patchKey = `entity:${mode}`
  if (object._viewportPatchedMode === patchKey) return

  const { canvas } = stage
  object._viewportPatchedMode = patchKey
  object.removeAllListeners?.('__pointermove')
  object.removeAllListeners?.('__pointerup')
  object.removeAllEventListeners?.('mousedown')
  object.removeAllEventListeners?.('pressmove')

  object.on(mode === 'webgl' ? '__pointermove' : 'mousedown', ({ stageX, stageY }) => {
    entry.dispatchEvent('entityClick', object.entity)
    stage.isObjectClick = true
    if (entry.type !== 'minimize' && stage.isEntitySelectable()) {
      object.offset = {
        x: -object.parent.x + object.entity.x - ((stageX - canvas.x) / canvas.scaleX),
        y: -object.parent.y - object.entity.y - ((stageY - canvas.y) / canvas.scaleY),
      }
      object.cursor = 'move'
      object.entity.initCommand()
      entry.container.selectObject(object.entity.parent.id)
    }
  })

  object.on(mode === 'webgl' ? '__pointerup' : 'pressmove', ({ stageX, stageY }) => {
    if (!stage.isEntitySelectable()) return
    if (!object.offset) return

    const { entity } = object
    if (entity.parent.getLock()) return
    entity.setX((stageX - canvas.x) / canvas.scaleX + object.offset.x)
    entity.setY((canvas.y - stageY) / canvas.scaleY - object.offset.y)
    stage.updateObject()
  })
}

function patchVariableObject(stage: Stage, variable: StageObject, mode: RenderMode, type: string, isRunState: () => boolean): void {
  const { canvas } = stage
  const { variable: variableObj } = variable
  const patchMainKey = `variable:${mode}`
  const downEvent = mode === 'webgl' ? '__pointermove' : 'mousedown'
  const moveEvent = mode === 'webgl' ? '__pointerup' : 'pressmove'

  if (variableObj.slideBar_) {
    const slideBar = variableObj.slideBar_
    const key = `slide:${mode}`
    if (slideBar._viewportPatchedMode !== key) {
      slideBar._viewportPatchedMode = key
      slideBar.removeAllListeners?.('__pointermove')
      slideBar.removeAllEventListeners?.('mousedown')
      slideBar.on(downEvent, ({ stageX }) => {
        if (!isRunState()) return
        variableObj.setSlideCommandX(stageX / canvas.scaleX - variableObj.getX() - canvas.x / canvas.scaleX)
      })
    }
  }

  if (variableObj.valueSetter_) {
    const valueSetter = variableObj.valueSetter_
    const key = `valueSetter:${mode}`
    if (valueSetter._viewportPatchedMode !== key) {
      valueSetter._viewportPatchedMode = key
      valueSetter.removeAllListeners?.('__pointermove')
      valueSetter.removeAllListeners?.('__pointerup')
      valueSetter.removeAllEventListeners?.('mousedown')
      valueSetter.removeAllEventListeners?.('pressmove')
      valueSetter.on(downEvent, ({ stageX }) => {
        if (!isRunState()) return
        variableObj.isAdjusting = true
        valueSetter.offsetX = stageX / canvas.scaleX - valueSetter.x
      })
      valueSetter.on(moveEvent, ({ stageX }) => {
        if (!isRunState()) return
        variableObj.setSlideCommandX(stageX / canvas.scaleX - valueSetter.offsetX + 5)
      })
    }
  }

  if (variableObj.resizeHandle_) {
    const resizeHandle = variableObj.resizeHandle_
    const key = `resizeHandle:${mode}`
    if (resizeHandle._viewportPatchedMode !== key) {
      resizeHandle._viewportPatchedMode = key
      resizeHandle.removeAllListeners?.('__pointermove')
      resizeHandle.removeAllListeners?.('__pointerup')
      resizeHandle.removeAllEventListeners?.('mousedown')
      resizeHandle.removeAllEventListeners?.('pressmove')
      resizeHandle.on(downEvent, ({ stageX, stageY }) => {
        variableObj.isResizing = true
        resizeHandle.offset = {
          x: stageX / canvas.scaleX - variableObj.getWidth(),
          y: stageY / canvas.scaleY - variableObj.getHeight(),
        }
        resizeHandle.parent.cursor = 'nwse-resize'
      })
      resizeHandle.on(moveEvent, ({ stageX, stageY }) => {
        if (!resizeHandle.offset) return
        variableObj.setWidth(stageX / canvas.scaleX - resizeHandle.offset.x)
        variableObj.setHeight(stageY / canvas.scaleY - resizeHandle.offset.y)
        variableObj.updateView()
      })
    }
  }

  if (variableObj.scrollButton_) {
    const scrollButton = variableObj.scrollButton_
    const key = `scrollButton:${mode}`
    if (scrollButton._viewportPatchedMode !== key) {
      scrollButton._viewportPatchedMode = key
      scrollButton.removeAllListeners?.('__pointermove')
      scrollButton.removeAllListeners?.('__pointerup')
      scrollButton.removeAllEventListeners?.('mousedown')
      scrollButton.removeAllEventListeners?.('pressmove')
      scrollButton.on(downEvent, ({ stageY }) => {
        variableObj.isResizing = true
        scrollButton.offsetY = stageY - scrollButton.y * canvas.scaleY
      })
      scrollButton.on(moveEvent, ({ stageY }) => {
        const offsetY = scrollButton.offsetY || 0
        const y = Math.max(25, Math.min(variableObj.getHeight() - 30, (stageY - offsetY) / canvas.scaleY))
        scrollButton.y = y
        variableObj.updateView()
      })
    }
  }

  if (variable._viewportPatchedMode !== patchMainKey) {
    variable._viewportPatchedMode = patchMainKey
    variable.removeAllListeners?.('__pointermove')
    variable.removeAllListeners?.('__pointerup')
    variable.removeAllEventListeners?.('mousedown')
    variable.removeAllEventListeners?.('pressmove')
    variable.on(downEvent, ({ stageX, stageY }) => {
      if (type !== 'workspace') return
      variable.offset = {
        x: variable.x - (stageX - canvas.x) / canvas.scaleX,
        y: variable.y - (stageY - canvas.y) / canvas.scaleY,
      }
    })
    variable.on(moveEvent, ({ stageX, stageY }) => {
      if (type !== 'workspace' || variableObj.isResizing || variableObj.isAdjusting) return
      if (!variable.offset) return
      variableObj.setX((stageX - canvas.x) / canvas.scaleX + variable.offset.x)
      variableObj.setY((stageY - canvas.y) / canvas.scaleY + variable.offset.y)
      variableObj.updateView()
    })
  }
}

function patchInteractions(entry: EntryGlobal, stage: Stage, mode: RenderMode): void {
  const isRunState = () => entry.engine.isState('run')
  entry.container.objects_.forEach(({ entity: { object } }) => patchEntityObject(entry, stage, object, mode))
  stage.variableContainer.children.forEach(variable => patchVariableObject(stage, variable, mode, entry.type, isRunState))
}

function updateEventCoordinate(stage: Stage): void {
  const { canvas } = stage
  stage.handle.getEventCoordinate = ({ stageX, stageY }) => ({
    x: (stageX - canvas.x) / canvas.scaleX,
    y: (stageY - canvas.y) / canvas.scaleY,
  })
}

function handleAutoRecording(isRunning: boolean, canvasElement: HTMLCanvasElement | undefined, settings: ExtensionSettings): void {
  const shouldRecord = settings.extensionEnabled && settings.autoRecordEnabled

  if (!shouldRecord) {
    if (canvasRecorder.isActive()) canvasRecorder.stop(true)
    runtimeState.wasRunning = false
    return
  }

  if (!canvasElement) {
    if (runtimeState.wasRunning) canvasRecorder.stop(true)
    runtimeState.wasRunning = false
    return
  }

  if (isRunning && !runtimeState.wasRunning) {
    void canvasRecorder.start(canvasElement, settings.includeAudio)
  } else if (!isRunning && runtimeState.wasRunning) {
    canvasRecorder.stop(true)
  }

  runtimeState.wasRunning = isRunning
}

function frame(): void {
  self.__REQUEST_ANIMATION_FRAME_ID = requestAnimationFrame(frame)
  try {
    const entry = getEntryGlobal()
    const stage = entry?.stage
    const settings = runtimeState.settings

    if (!entry || !stage) {
      handleAutoRecording(false, undefined, settings)
      return
    }

    const isRunning = entry.engine.isState('run')
    handleAutoRecording(isRunning, stage.canvas.canvas, settings)

    if (!settings.extensionEnabled) {
      runtimeState.lastMode = ''
      runtimeState.lastObjectCount = 0
      runtimeState.lastVariableCount = 0
      return
    }

    const { useWebGL } = entry.options
    const mode: RenderMode = useWebGL ? 'webgl' : 'canvas'
    const qualityBoost = settings.qualityEnabled ? settings.qualityBoost : 1
    const canvasElement = stage.canvas.canvas
    const { width, height } = computeRenderSize(canvasElement, qualityBoost)
    const resolution = width / BASE_WIDTH

    const resized = canvasElement.width !== width || canvasElement.height !== height
    if (resized) resizeStage(stage, width, height)

    if (useWebGL && (resized || runtimeState.lastResolution !== resolution)) {
      updateTextResolution(stage.canvas.children, resolution)
    }
    runtimeState.lastResolution = resolution

    updateInputField(entry, stage, width, height, useWebGL)
    updateEventCoordinate(stage)

    const now = performance.now()
    const objectCount = entry.container.objects_.length
    const variableCount = stage.variableContainer.children.length
    const shouldPatch = runtimeState.lastMode !== mode
      || runtimeState.lastObjectCount !== objectCount
      || runtimeState.lastVariableCount !== variableCount
      || now - runtimeState.lastPatchAt >= PATCH_INTERVAL_MS

    if (shouldPatch) {
      patchInteractions(entry, stage, mode)
      runtimeState.lastMode = mode
      runtimeState.lastPatchAt = now
      runtimeState.lastObjectCount = objectCount
      runtimeState.lastVariableCount = variableCount
    }
  } catch {
    // Keep the animation loop alive when Entry internals change.
  }
}

if (!self.__REQUEST_ANIMATION_FRAME_ID) {
  self.__REQUEST_ANIMATION_FRAME_ID = requestAnimationFrame(frame)
}

export {}
