class EventEmitter {
    eventListeners = Object.create(null)
    on = (eventName, callback) => (this.eventListeners[eventName] = this.eventListeners[eventName] || []).push(callback)
    off = (eventName, callback) => {
        if (!this.eventListeners[eventName]) return
        this.eventListeners[eventName] = this.eventListeners[eventName].filter(cb => cb !== callback)
    }
    emit = (eventName, payload) => (this.eventListeners[eventName] || []).forEach(callback => callback(payload))
    removeAllListeners = () => this.eventListeners = Object.create(null)
}

class AnimationFrameManager {
    rafId = null
    schedule = (callback, options = {}) => {
        if (this.rafId) {
            if (options.overwrite !== false) cancelAnimationFrame(this.rafId)
            else return
        }
        this.rafId = requestAnimationFrame(() => {
            callback()
            this.rafId = null
        })
    }
    cancel = () => {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
    }
}

const Geometry = {
    calcDistanceSq: (x1, y1, x2, y2) => (x2 - x1) ** 2 + (y2 - y1) ** 2,
    calcAngle: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI,
    get4WayDirection: (angle) => (angle >= -45 && angle < 45) ? "→" : (angle >= 45 && angle < 135) ? "↓" : (angle >= -135 && angle < -45) ? "↑" : "←",
    get8WayDirection: (angle) => (angle >= -22.5 && angle < 22.5) ? "→" : (angle >= 22.5 && angle < 67.5) ? "↘" : (angle >= 67.5 && angle < 112.5) ? "↓" : (angle >= 112.5 && angle < 157.5) ? "↙" : (angle >= 157.5 || angle < -157.5) ? "←" : (angle >= -157.5 && angle < -112.5) ? "↖" : (angle >= -112.5 && angle < -67.5) ? "↑" : "↗",
}

class BaseGestureStrategy {
    constructor(options = {}, directionCalculator) {
        this.options = { macroRadius: 35, tailRadius: 15, ...options }
        this.macroRadiusSq = this.options.macroRadius ** 2
        this.tailRadiusSq = this.options.tailRadius ** 2
        this.directionCalculator = directionCalculator
    }

    initialize = (x, y) => {
        this.anchorX = x
        this.anchorY = y
        this.paths = []
        return { changed: true, newDirection: null, paths: this.paths }
    }
    _processPoint = (x, y, thresholdSq) => {
        let changed = false
        let newDirection = null
        if (this.anchorX === undefined) {
            return { changed, newDirection, paths: this.paths }
        }
        if (Geometry.calcDistanceSq(this.anchorX, this.anchorY, x, y) >= thresholdSq) {
            const direction = this.directionCalculator(Geometry.calcAngle(this.anchorX, this.anchorY, x, y))
            if (this.paths.length === 0 || this.paths.at(-1) !== direction) {
                this.paths.push(direction)
                changed = true
                newDirection = direction
            }
            this.anchorX = x
            this.anchorY = y
        }
        return { changed, newDirection, paths: this.paths }
    }
    processMove = (x, y) => this._processPoint(x, y, this.macroRadiusSq)
    processEnd = (x, y) => this._processPoint(x, y, this.tailRadiusSq)
    isActive = () => this.paths.length > 0
}

class StrategyFourWay extends BaseGestureStrategy {
    constructor(options = {}) {
        super(options, Geometry.get4WayDirection)
    }
}

class StrategyEightWay extends BaseGestureStrategy {
    constructor(options = {}) {
        super(options, Geometry.get8WayDirection)
    }
}

class StrategyAdaptive {
    constructor(options = {}) {
        this.fourWay = new StrategyFourWay(options)
        this.eightWay = new StrategyEightWay(options)
        this.wasDegraded = false
    }

    initialize = (x, y) => {
        this.fourWay.initialize(x, y)
        this.eightWay.initialize(x, y)
        this.wasDegraded = false
        return { changed: true, newDirection: null, paths: [] }
    }

    _dispatch = (x, y, methodName) => {
        const state4 = this.fourWay[methodName](x, y)
        if (this.wasDegraded) return state4
        const state8 = this.eightWay[methodName](x, y)
        if (this.eightWay.paths.length > 1) {
            this.wasDegraded = true
            return { changed: true, paths: state4.paths, newDirection: state4.paths.at(-1) || null }
        }
        return state8
    }

    processMove = (x, y) => this._dispatch(x, y, "processMove")
    processEnd = (x, y) => this._dispatch(x, y, "processEnd")

    isActive = () => this.eightWay.isActive()
}

class GestureEngine extends EventEmitter {
    isTracking = false
    isAborted = false
    hasMovedSinceStart = false
    currentTriggerButton = null
    plugins = []
    _watchdogTimer = null
    _lastMoveTimestamp = 0

    constructor(options = {}) {
        super()
        this.options = {
            targetElement: document,
            triggerButtons: [2],
            strategy: null,
            suppressFn: null,
            allowedPointerTypes: ["mouse", "pen"],
            startTimeout: 1000,
            idleTimeout: 2000,
            ...options,
        }

        this.setStrategy(this.options.strategy)
        this._bindEvents()
    }

    updateConfig = (newConfig) => this.options = { ...this.options, ...newConfig }
    setStrategy = (strategyImpl) => {
        this._validateStrategy(strategyImpl)
        this.activeStrategy = strategyImpl
    }
    use = (pluginImpl) => {
        if (typeof pluginImpl?.install !== "function") {
            throw new TypeError("GestureEngine.use: plugin must have an 'install' method.")
        }
        pluginImpl.install(this)
        this.plugins.push(pluginImpl)
        return this
    }

    destroy = () => {
        this._unbindEvents()
        this._clearTimers()
        this.plugins.forEach(p => p.uninstall?.())
        this.plugins = []
        this.removeAllListeners()
        this.emit("destroyed", null)
    }

    getHasMoved = () => this.hasMovedSinceStart

    _validateStrategy = (strategyImpl) => {
        if (!strategyImpl) throw new Error("A valid strategy instance must be provided.")
        const requiredMethods = ["initialize", "processMove", "processEnd", "isActive"]
        for (const method of requiredMethods) {
            if (typeof strategyImpl[method] !== "function") throw new TypeError(`Missing method: '${method}'`)
        }
    }

    _clearTimers = () => {
        if (this._watchdogTimer) {
            clearInterval(this._watchdogTimer)
            this._watchdogTimer = null
        }
    }

    _abortGesture = (reason) => {
        this.isTracking = false
        this.isAborted = true
        this.currentTriggerButton = null
        this._clearTimers()
        this.emit("abort", { reason })
    }

    _toggleEvents = (enable) => {
        const fn = enable ? "addEventListener" : "removeEventListener"
        const target = this.options.targetElement
        const opts = { capture: true, passive: false }
        target[fn]("pointerdown", this._handlePointerDown, opts)
        target[fn]("pointermove", this._handlePointerMove, opts)
        target[fn]("pointerup", this._handlePointerUp, opts)
        target[fn]("pointercancel", this._handlePointerCancel, opts)
        target[fn]("contextmenu", this._handleNativeBehavior, opts)
        target[fn]("mousedown", this._handleNativeBehavior, opts)
        target[fn]("mouseup", this._handleNativeBehavior, opts)
        // target[fn]("auxclick", this._handleNativeBehavior, opts)
    }
    _bindEvents = () => this._toggleEvents(true)
    _unbindEvents = () => this._toggleEvents(false)

    _handleNativeBehavior = (ev) => {
        if (!this.options.triggerButtons.includes(ev.button)) return
        if (ev.button === 1 && ev.type === "mousedown") {
            ev.preventDefault()
            return
        }
        if (this.hasMovedSinceStart) {
            ev.preventDefault()
            ev.stopPropagation()
        }
    }

    _handlePointerDown = (ev) => {
        if (this.options.allowedPointerTypes && !this.options.allowedPointerTypes.includes(ev.pointerType)) return
        if (!this.options.triggerButtons.includes(ev.button)) return
        if (this.options.suppressFn?.(ev)) {
            this.emit("suppressed", { originalEvent: ev, triggerButton: ev.button })
            return
        }
        ev.target.setPointerCapture?.(ev.pointerId)

        this.isTracking = true
        this.hasMovedSinceStart = false
        this.isAborted = false
        this.currentTriggerButton = ev.button
        this._clearTimers()
        const x = ev.clientX
        const y = ev.clientY
        const state = this.activeStrategy.initialize(x, y)
        this.emit("start", { point: { x, y }, triggerButton: this.currentTriggerButton, originalEvent: ev })
        if (state.changed) {
            this.emit("pathChange", { paths: state.paths, newDirection: state.newDirection, triggerButton: this.currentTriggerButton })
        }

        this._lastMoveTimestamp = ev.timeStamp
        if (this.options.startTimeout > 0 || this.options.idleTimeout > 0) {
            this._watchdogTimer = setInterval(() => {
                const elapsed = performance.now() - this._lastMoveTimestamp
                if (this.hasMovedSinceStart) {
                    if (this.options.idleTimeout > 0 && elapsed >= this.options.idleTimeout) this._abortGesture("idleTimeout")
                } else {
                    if (this.options.startTimeout > 0 && elapsed >= this.options.startTimeout) this._abortGesture("startTimeout")
                }
            }, 100)
        }
    }

    _handlePointerMove = (ev) => {
        if (!this.isTracking || this.isAborted) return

        this._lastMoveTimestamp = ev.timeStamp
        this.hasMovedSinceStart = true
        const x = ev.clientX
        const y = ev.clientY
        const state = this.activeStrategy.processMove(x, y)
        this.emit("move", {
            point: { x, y },
            paths: state.paths,
            triggerButton: this.currentTriggerButton,
            originalEvent: ev,
        })
        if (state.changed) {
            this.emit("pathChange", { paths: state.paths, newDirection: state.newDirection, triggerButton: this.currentTriggerButton })
        }
    }

    _handlePointerUp = (ev) => {
        this._clearTimers()
        if (!this.isTracking || this.isAborted || ev.button !== this.currentTriggerButton) return

        ev.target.releasePointerCapture?.(ev.pointerId)
        this.isTracking = false
        const x = ev.clientX
        const y = ev.clientY
        const state = this.activeStrategy.processEnd(x, y)
        if (state.changed) {
            this.emit("pathChange", { paths: state.paths, newDirection: state.newDirection, triggerButton: this.currentTriggerButton })
        }
        this.emit("end", {
            paths: state.paths,
            gestureCode: state.paths.join(""),
            triggerButton: this.currentTriggerButton,
            originalEvent: ev,
        })
        this.currentTriggerButton = null
    }

    _handlePointerCancel = (ev) => {
        if (this.isTracking) {
            ev.target.releasePointerCapture?.(ev.pointerId)
            this._abortGesture("systemCancel")
        }
    }
}

class GestureVisualizer {
    timer = null
    pointBuffer = []
    logicalWidth = 0
    logicalHeight = 0
    rafManager = new AnimationFrameManager()

    constructor(el, options = {}) {
        if (el instanceof HTMLCanvasElement) {
            this.canvasEl = el
        } else {
            throw new TypeError(`Missing prop: 'el'`)
        }
        this.options = {
            lineWidth: 5,
            cleanupDelay: 200,
            minDrawDistance: 2,
            colorFormatter: (paths, button) => "#7dcfff",
            ...options,
        }
        this.minDistanceSq = this.options.minDrawDistance ** 2
        this.ctx = this.canvasEl.getContext("2d")
    }

    install = (engine) => {
        engine.on("start", this._handleStart)
        engine.on("move", this._handleMove)
        engine.on("end", this._handleEnd)
        engine.on("abort", this._handleAbort)
    }

    uninstall = () => {
        if (this.timer) clearTimeout(this.timer)
        this.rafManager.cancel()
    }

    _handleStart = (payload) => {
        if (this.timer) clearTimeout(this.timer)
        this.rafManager.cancel()
        this.pointBuffer.length = 0

        this.canvasEl.classList.add("active")
        const rect = this.canvasEl.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        this.logicalWidth = rect.width
        this.logicalHeight = rect.height
        this.canvasEl.width = this.logicalWidth * dpr
        this.canvasEl.height = this.logicalHeight * dpr
        this.ctx.scale(dpr, dpr)

        this.ctx.lineWidth = this.options.lineWidth
        this.ctx.lineCap = "round"
        this.ctx.lineJoin = "round"
        this.ctx.strokeStyle = this.options.colorFormatter([], payload.triggerButton)
        this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight)
        this.ctx.beginPath()
        this.ctx.moveTo(payload.point.x, payload.point.y)
        this.pointBuffer.push(payload.point.x, payload.point.y)
    }

    _handleMove = (payload) => {
        const { x, y } = payload.point
        const len = this.pointBuffer.length
        if (len >= 2) {
            const dx = x - this.pointBuffer[len - 2]
            const dy = y - this.pointBuffer[len - 1]
            if (dx * dx + dy * dy < this.minDistanceSq) return
        }

        this.pointBuffer.push(x, y)
        this.rafManager.schedule(() => this._flushBuffer(payload), { overwrite: false })
    }

    _flushBuffer = (payload) => {
        if (this.pointBuffer.length <= 2 || !payload) return

        this.ctx.strokeStyle = this.options.colorFormatter(payload.paths, payload.triggerButton)
        for (let i = 0; i < this.pointBuffer.length; i += 2) {
            this.ctx.lineTo(this.pointBuffer[i], this.pointBuffer[i + 1])
        }
        this.ctx.stroke()
        this.ctx.beginPath()
        const len = this.pointBuffer.length
        const lastX = this.pointBuffer[len - 2]
        const lastY = this.pointBuffer[len - 1]
        this.ctx.moveTo(lastX, lastY)

        this.pointBuffer[0] = lastX
        this.pointBuffer[1] = lastY
        this.pointBuffer.length = 2
    }

    _handleEnd = (payload) => {
        if (this.pointBuffer.length > 2) {
            this.rafManager.cancel()
            this._flushBuffer(payload)
        }
        this.canvasEl.classList.remove("active")
        this.timer = setTimeout(() => {
            this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight)
            this.pointBuffer.length = 0
        }, this.options.cleanupDelay)
    }

    _handleAbort = () => {
        if (this.timer) clearTimeout(this.timer)
        this.rafManager.cancel()
        this.pointBuffer.length = 0
        this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight)
        this.canvasEl.classList.remove("active")
    }
}

class GestureHUD {
    hideElTimer = null

    constructor(el, options = {}) {
        if (el instanceof HTMLElement) {
            this.el = el
        } else {
            throw new TypeError(`Missing prop: 'el'`)
        }
        this.options = {
            cleanupDelay: 200,
            textFormatter: (paths, button) => paths.join(""),
            colorFormatter: (paths, button) => "#7dcfff",
            ...options,
        }
    }

    install = (engine) => {
        engine.on("start", this._handleStart)
        engine.on("pathChange", this._handlePathChange)
        engine.on("end", this._handleEnd)
        engine.on("abort", this._handleAbort)
    }

    uninstall = () => {
        if (this.hideElTimer) clearTimeout(this.hideElTimer)
    }

    _handleStart = () => {
        if (this.hideElTimer) clearTimeout(this.hideElTimer)
        this.el.classList.add("active")
    }

    _handlePathChange = (payload) => {
        this.el.textContent = this.options.textFormatter(payload.paths, payload.triggerButton)
        this.el.style.color = this.options.colorFormatter(payload.paths, payload.triggerButton)
    }

    _handleEnd = () => {
        this.el.classList.remove("active")
        this.hideElTimer = setTimeout(() => {
            this.el.textContent = ""
            this.el.style.removeProperty("color")
        }, this.options.cleanupDelay)
    }

    _handleAbort = () => {
        if (this.hideElTimer) clearTimeout(this.hideElTimer)
        this.el.classList.remove("active")
        this.el.textContent = ""
        this.el.style.removeProperty("color")
    }
}

class GestureActionManager {
    constructor({ actions = [], ...options } = {}) {
        this.actionRegistry = new Map()
        this.lastTriggerTimes = new WeakMap()
        this.options = {
            globalCooldown: 0,
            onBeforeAction: (actionDef, payload) => true,
            onAfterAction: (actionDef, payload, result) => null,
            onMissed: (exactKey, payload) => null,
            onCooldown: (actionDef, payload, remainingTime) => console.warn(`[Action Cooldown] ${actionDef.name || "Unknown"} is cooling down. Wait ${remainingTime}ms.`),
            onConditionFailed: (actionDef, payload) => null,
            onError: (err, actionDef) => console.error(`[Action Error] ${actionDef.name || "Unknown"}:`, err),
            ...options,
        }
        actions.forEach(this.register)
    }

    install = (engine) => {
        this.engine = engine
        this.engine?.on("end", this._handleEnd)
    }

    uninstall = () => {
        this.engine?.off("end", this._handleEnd)
        this.actionRegistry.clear()
    }

    _normalizeMatchKey = (actionDef) => {
        const buttonMap = { "middle": 1, "right": 2, "x1": 3, "x2": 4 }
        const { button, path } = actionDef
        if (!path || typeof path !== "string") {
            throw new TypeError(`[Gesture Error] Action "${actionDef.name || "Unknown"}" must have a valid 'path' string.`)
        }
        if (button) {
            const btnCode = buttonMap[String(button).toLowerCase()]
            if (btnCode === undefined) {
                throw new TypeError(`[Gesture Error] Invalid button "${button}".`)
            }
            return `${btnCode}:${path}`
        }
        return path
    }

    register = (actionDef) => {
        if (typeof actionDef.execute !== "function") {
            throw new TypeError(`[Gesture Error] Action "${actionDef.name || "Unknown"}" must include an 'execute' function.`)
        }
        this.actionRegistry.set(this._normalizeMatchKey(actionDef), actionDef)
        return this
    }

    unregister = (actionDef) => {
        this.actionRegistry.delete(this._normalizeMatchKey(actionDef))
        return this
    }

    hasMatchedAction = (buttonCode, pathStr) => {
        const exactKey = `${buttonCode}:${pathStr}`
        return this.actionRegistry.has(exactKey) || this.actionRegistry.has(pathStr)
    }

    _handleEnd = (payload) => {
        const genericKey = payload.gestureCode
        if (!genericKey) {
            this.options.onMissed("", payload)
            return
        }
        const exactKey = `${payload.triggerButton}:${genericKey}`
        const matchedAction = this.actionRegistry.get(exactKey) || this.actionRegistry.get(genericKey)
        if (!matchedAction) {
            this.options.onMissed(exactKey, payload)
            return
        }
        this._executeAction(matchedAction, payload)
    }

    _executeAction = (actionDef, payload) => {
        const now = Date.now()
        const cooldown = actionDef.cooldown ?? this.options.globalCooldown
        if (cooldown > 0) {
            const lastTime = this.lastTriggerTimes.get(actionDef) || 0
            const remainingTime = cooldown - (now - lastTime)
            if (remainingTime > 0) {
                this.options.onCooldown(actionDef, payload, remainingTime)
                return
            }
        }
        if (typeof actionDef.condition === "function" && !actionDef.condition(payload)) {
            this.options.onConditionFailed(actionDef, payload)
            return
        }
        try {
            const shouldProceed = this.options.onBeforeAction(actionDef, payload)
            if (shouldProceed === false) return
            this.lastTriggerTimes.set(actionDef, now)
            const result = actionDef.execute(payload)
            this.options.onAfterAction(actionDef, payload, result)
        } catch (error) {
            this.options.onError(error, actionDef)
        }
    }
}

class MouseGesturesPlugin extends BasePlugin {
    styleTemplate = () => true

    html = () => {
        const canvasEl = this.config.SHOW_VISUALIZER ? `<canvas id="plugin-mouse-gestures-visualizer"></canvas>` : ""
        const hudEl = this.config.SHOW_GESTURE_HUD ? `<div id="plugin-mouse-gestures-hud"></div>` : ""
        return canvasEl + hudEl
    }

    getGestures = () => new Map(
        this.config.GESTURES
            .filter(g => g.enable && g.execute && /^[→←↑↓↘↙↗↖]+$/u.test(g.path))
            .map(g => {
                const fn = eval(g.execute)
                return (typeof fn === "function") ? [g.path, { ...g, execute: fn }] : null
            })
            .filter(Boolean),
    )

    initEngine = (gestures) => {
        const buttons = ["left", "middle", "right", "x1", "x2"]
        const buttonNames = this.i18n.array(buttons, "$option.GESTURES.button.")
        const getTriggerButtons = (triggers) => triggers.map(btn => buttons.indexOf(btn)).filter(x => x !== -1)
        const getSuppressFn = () => {
            const k = this.config.SUPPRESSION_KEY
            if (!k) return null
            const key = `${k}Key`
            return (ev) => ev[key] === true
        }
        const getStrategy = (name) => {
            const cfg = { macroRadius: this.config.MACRO_RADIUS, tailRadius: this.config.TAIL_RADIUS }
            const strategies = { fourWay: StrategyFourWay, eightWay: StrategyEightWay, adaptive: StrategyAdaptive }
            return new strategies[name](cfg)
        }
        const colorFormatter = (paths, btn) => this.config.DEFAULT_COLOR[buttons[btn]] || "#7dcfff"

        const engine = new GestureEngine({
            triggerButtons: getTriggerButtons(this.config.TRIGGER_BUTTONS),
            strategy: getStrategy(this.config.STRATEGY),
            suppressFn: getSuppressFn(),
            allowedPointerTypes: ["mouse"],
            startTimeout: this.config.START_TIMEOUT,
            idleTimeout: this.config.IDLE_TIMEOUT,
        })
        if (this.config.SHOW_VISUALIZER) {
            engine.use(new GestureVisualizer(document.getElementById("plugin-mouse-gestures-visualizer"), {
                lineWidth: this.config.TRAJECTORY_LINE_WIDTH,
                colorFormatter,
            }))
        }
        if (this.config.SHOW_GESTURE_HUD) {
            engine.use(new GestureHUD(document.getElementById("plugin-mouse-gestures-hud"), {
                colorFormatter,
                textFormatter: (paths, btn) => {
                    if (paths.length === 0) return ""
                    const code = paths.join("")
                    const ges = gestures.get(code)
                    return (buttons.indexOf(ges?.button) === btn && ges?.name) || `[${buttonNames[btn]}] ${code}`
                },
            }))
        }
        engine.use(new GestureActionManager({
            actions: gestures.values(),
            globalCooldown: this.config.COOLDOWN,
        }))

        return engine
    }

    process = () => {
        const gestures = this.getGestures()
        this.engine = this.initEngine(gestures)
    }
}

module.exports = {
    plugin: MouseGesturesPlugin,
}
