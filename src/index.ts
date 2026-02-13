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
  offset: {
    x: number
    y: number
  }
  on(event: string, handler: (event: StageEvent) => void): void
  removeAllListeners?(event: string): void
  removeAllEventListeners?(event: string): void
  entity: Entity
  _viewportPatchedMode?: string
  _events?: {
    [k: string]: {
      fn(event: StageEvent): void
    }
  }
}

interface Handle {
  // dispatchEditStartEvent(): void
  // getGlobalCoordinate(object: StageObject): {
  //   x: number
  //   y: number
  // }
  // knobs: StageObject[]
  getEventCoordinate(event: StageEvent): {
    x: number
    y: number
  }
}

const QUALITY_BOOST = 1.5
const MAX_RENDER_WIDTH = 1920
const BASE_WIDTH = 640
const BASE_HEIGHT = 360
const PATCH_INTERVAL_MS = 300

const runtimeState = {
  lastMode: '' as RenderMode | '',
  lastPatchAt: 0,
  lastObjectCount: 0,
  lastVariableCount: 0,
  lastResolution: 0,
}

function getEntryGlobal(): EntryGlobal | undefined {
  const frameWindow = (document.querySelector('iframe.eaizycc0') as HTMLIFrameElement | null)?.contentWindow
  const hostWindow = (frameWindow || self) as Window & { Entry?: EntryGlobal }
  return hostWindow.Entry
}

function computeRenderSize(canvasElement: HTMLCanvasElement): { width: number, height: number } {
  const cssWidth = Math.round(canvasElement.offsetWidth)
  if (cssWidth <= 0) return {
    width: Math.max(BASE_WIDTH, canvasElement.width || BASE_WIDTH),
    height: Math.max(BASE_HEIGHT, canvasElement.height || BASE_HEIGHT),
  }

  const width = Math.max(
    BASE_WIDTH,
    Math.min(
      MAX_RENDER_WIDTH,
      Math.round(cssWidth * Math.max(1, devicePixelRatio) * QUALITY_BOOST),
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
      slideBar.on(downEvent, ({ stageX }) => isRunState() && variableObj.setSlideCommandX(stageX / canvas.scaleX - variableObj.getX() - canvas.x / canvas.scaleX))
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
      valueSetter.on(moveEvent, ({ stageX }) => isRunState() && variableObj.setSlideCommandX(stageX / canvas.scaleX - valueSetter.offsetX + 5))
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
        const y = Math.max(25, Math.min(variableObj.getHeight() - 30, (stageY - scrollButton.offsetY) / canvas.scaleY))
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

function frame(): void {
  self.__REQUEST_ANIMATION_FRAME_ID = requestAnimationFrame(frame)
  try {
    const entry = getEntryGlobal()
    const stage = entry?.stage
    if (!entry || !stage) return

    const { useWebGL } = entry.options
    const mode: RenderMode = useWebGL ? 'webgl' : 'canvas'
    const canvasElement = stage.canvas.canvas
    const { width, height } = computeRenderSize(canvasElement)
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
    // Keep the render loop alive even when Entry internals temporarily change.
  }
}

if (!self.__REQUEST_ANIMATION_FRAME_ID) {
  self.__REQUEST_ANIMATION_FRAME_ID = requestAnimationFrame(frame)
}

export {}
