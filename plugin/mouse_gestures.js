const RAD_TO_DEG = 180 / Math.PI

class BaseGestureStrategy {
    _state = { changed: false, newDirection: null, paths: [] }

    constructor(options = {}, calcDirection) {
        this.options = { macroRadius: 35, tailRadius: 15, ...options }
        this.macroRadiusSq = this.options.macroRadius ** 2
        this.tailRadiusSq = this.options.tailRadius ** 2
        this.calcDirection = calcDirection
    }

    initialize = (x, y) => {
        this.anchorX = x
        this.anchorY = y
        this.paths = []

        this._state.changed = true
        this._state.newDirection = null
        this._state.paths = this.paths
        return this._state
    }

    _processPoint = (x, y, thresholdSq) => {
        let changed = false
        let newDirection = null
        if (this.anchorX === undefined) {
            this._state.changed = changed
            this._state.newDirection = newDirection
            this._state.paths = this.paths
            return this._state
        }

        const dx = x - this.anchorX
        const dy = y - this.anchorY
        const distSq = dx * dx + dy * dy
        if (distSq >= thresholdSq) {
            const angle = Math.atan2(dy, dx) * RAD_TO_DEG
            const direction = this.calcDirection(angle, this.paths)
            if (this.paths.length === 0 || this.paths[this.paths.length - 1] !== direction) {
                this.paths.push(direction)
                changed = true
                newDirection = direction
            }
            this.anchorX = x
            this.anchorY = y
        }

        this._state.changed = changed
        this._state.newDirection = newDirection
        this._state.paths = this.paths
        return this._state
    }
    processMove = (x, y) => this._processPoint(x, y, this.macroRadiusSq)
    processEnd = (x, y) => this._processPoint(x, y, this.tailRadiusSq)
    isActive = () => this.paths.length > 0
}

class Strategy4Way extends BaseGestureStrategy {
    constructor(options = {}) {
        const calcDirection = (angle) => (angle >= -45 && angle < 45) ? "→" : (angle >= 45 && angle < 135) ? "↓" : (angle >= -135 && angle < -45) ? "↑" : "←"
        super(options, calcDirection)
    }
}

class Strategy8Way extends BaseGestureStrategy {
    constructor(options = {}) {
        const calcDirection = (angle) => (angle >= -22.5 && angle < 22.5) ? "→" : (angle >= 22.5 && angle < 67.5) ? "↘" : (angle >= 67.5 && angle < 112.5) ? "↓" : (angle >= 112.5 && angle < 157.5) ? "↙" : (angle >= 157.5 || angle < -157.5) ? "←" : (angle >= -157.5 && angle < -112.5) ? "↖" : (angle >= -112.5 && angle < -67.5) ? "↑" : "↗"
        super(options, calcDirection)
    }
}

class Strategy4WayHysteresis extends BaseGestureStrategy {
    constructor(options = {}) {
        const h = options.hysteresis ?? 15
        super(options, (angle, paths) => {
            let sR = Math.abs(angle)
            let sD = Math.abs(angle - 90)
            let sL = Math.abs(Math.abs(angle) - 180)
            let sU = Math.abs(angle + 90)

            const last = paths.length > 0 ? paths[paths.length - 1] : null
            if (last === "→") sR -= h
            else if (last === "↓") sD -= h
            else if (last === "←") sL -= h
            else if (last === "↑") sU -= h

            if (sR <= sD && sR <= sL && sR <= sU) return "→"
            if (sD <= sR && sD <= sL && sD <= sU) return "↓"
            if (sL <= sR && sL <= sD && sL <= sU) return "←"
            return "↑"
        })
    }
}

class Strategy8WayHysteresis extends BaseGestureStrategy {
    constructor(options = {}) {
        const h = options.hysteresis ?? 8
        super(options, (angle, paths) => {
            let sR = Math.abs(angle)
            let sDR = Math.abs(angle - 45)
            let sD = Math.abs(angle - 90)
            let sDL = Math.abs(angle - 135)
            let sL = Math.abs(Math.abs(angle) - 180)
            let sUL = Math.abs(angle + 135)
            let sU = Math.abs(angle + 90)
            let sUR = Math.abs(angle + 45)

            const last = paths.length > 0 ? paths[paths.length - 1] : null
            if (last === "→") sR -= h
            else if (last === "↘") sDR -= h
            else if (last === "↓") sD -= h
            else if (last === "↙") sDL -= h
            else if (last === "←") sL -= h
            else if (last === "↖") sUL -= h
            else if (last === "↑") sU -= h
            else if (last === "↗") sUR -= h

            let min = sR, dir = "→"
            if (sDR < min) {
                min = sDR
                dir = "↘"
            }
            if (sD < min) {
                min = sD
                dir = "↓"
            }
            if (sDL < min) {
                min = sDL
                dir = "↙"
            }
            if (sL < min) {
                min = sL
                dir = "←"
            }
            if (sUL < min) {
                min = sUL
                dir = "↖"
            }
            if (sU < min) {
                min = sU
                dir = "↑"
            }
            if (sUR < min) {
                min = sUR
                dir = "↗"
            }
            return dir
        })
    }
}

class BaseAdaptiveStrategy {
    _wasDegraded = false
    _state = { changed: false, newDirection: null, paths: [] }

    constructor(fallbackStrategy, primaryStrategy) {
        this._fallback = fallbackStrategy
        this._primary = primaryStrategy
    }

    initialize = (x, y) => {
        this._fallback.initialize(x, y)
        this._primary.initialize(x, y)
        this._wasDegraded = false

        this._state.changed = true
        this._state.newDirection = null
        this._state.paths = []
        return this._state
    }

    _dispatch = (x, y, methodName) => {
        const stateFallback = this._fallback[methodName](x, y)
        if (this._wasDegraded) return stateFallback
        const statePrimary = this._primary[methodName](x, y)
        if (this._primary.paths.length > 1) {
            this._wasDegraded = true

            this._state.changed = stateFallback.changed
            this._state.paths = stateFallback.paths
            this._state.newDirection = stateFallback.changed ? stateFallback.newDirection : null
            return this._state
        }
        return statePrimary
    }

    processMove = (x, y) => this._dispatch(x, y, "processMove")
    processEnd = (x, y) => this._dispatch(x, y, "processEnd")
    isActive = () => this._wasDegraded ? this._fallback.isActive() : this._primary.isActive()
}

class StrategyAdaptive extends BaseAdaptiveStrategy {
    constructor(options = {}) {
        super(new Strategy4Way(options), new Strategy8Way(options))
    }
}

class StrategyAdaptiveHysteresis extends BaseAdaptiveStrategy {
    constructor(options = {}) {
        super(new Strategy4WayHysteresis(options), new Strategy8WayHysteresis(options))
    }
}

class GestureEngine {
    plugins = new Map()
    isTracking = false
    isAborted = false
    isPaused = false
    hasMovedSinceStart = false
    lastMoveTimestamp = 0
    currentTriggerButton = null
    _sharedMovePayload = {
        point: { x: 0, y: 0 },
        paths: null,
        triggerButton: null,
        originalEvent: null,
    }

    constructor(options = {}) {
        this.options = {
            targetElement: document,
            triggerButtons: [2],
            allowedPointerTypes: ["mouse", "pen"],
            strategy: null,
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

    use = (plugin) => {
        if (!plugin || typeof plugin.id !== "string") {
            throw new TypeError("[GestureEngine] plugin must have a valid 'id'.")
        }
        if (typeof plugin.install !== "function") {
            throw new TypeError(`[GestureEngine] plugin '${plugin.id}' must have an 'install' method.`)
        }
        if (!this.plugins.has(plugin.id)) {
            plugin.install(this)
            this.plugins.set(plugin.id, plugin)
        } else {
            console.warn(`[GestureEngine] Plugin with id '${plugin.id}' is already installed.`)
        }
        return this
    }

    unuse = (pluginOrId) => {
        const id = typeof pluginOrId === "string" ? pluginOrId : pluginOrId?.id
        if (id && this.plugins.has(id)) {
            this.plugins.get(id)?.uninstall?.()
            this.plugins.delete(id)
        }
        return this
    }

    getPlugin = (id) => this.plugins.get(id)

    pause = () => {
        if (this.isPaused) return
        this.isPaused = true
        if (this.isTracking) this.abort("paused")
        this._invokeHook("onPaused", null)
    }

    resume = () => {
        if (!this.isPaused) return
        this.isPaused = false
        this._invokeHook("onResumed", null)
    }

    abort = (reason = "aborted") => {
        if (!this.isTracking || this.isAborted) return
        this.isTracking = false
        this.isAborted = true
        this.currentTriggerButton = null
        this._invokeHook("onAbort", { reason })
    }

    destroy = () => {
        this._unbindEvents()
        this.plugins.forEach(p => p.uninstall?.())
        this.plugins.clear()
        this._invokeHook("onDestroyed", null)
    }

    getHasMoved = () => this.hasMovedSinceStart
    getLastMoveTimestamp = () => this.lastMoveTimestamp

    _invokeHook = (hookName, payload) => {
        for (const plugin of this.plugins.values()) plugin[hookName]?.(payload)
    }

    _invokeBailoutHook = (hookName, payload) => {
        for (const plugin of this.plugins.values()) {
            if (plugin[hookName]?.(payload) === false) return false
        }
        return true
    }

    _validateStrategy = (strategyImpl) => {
        if (!strategyImpl) throw new Error("A valid strategy instance must be provided.")
        const requiredMethods = ["initialize", "processMove", "processEnd", "isActive"]
        for (const method of requiredMethods) {
            if (typeof strategyImpl[method] !== "function") throw new TypeError(`Missing method: '${method}'`)
        }
    }

    _toggleEvents = (enable) => {
        const fn = enable ? "addEventListener" : "removeEventListener"
        const target = this.options.targetElement
        const blockOpts = { capture: true, passive: false }
        const passiveOpts = { capture: true, passive: true }
        target[fn]("pointerdown", this._onPointerDown, blockOpts)
        target[fn]("pointermove", this._onPointerMove, passiveOpts)
        target[fn]("pointerup", this._onPointerUp, passiveOpts)
        target[fn]("pointercancel", this._onPointerCancel, passiveOpts)
        target[fn]("contextmenu", this._onNativeBehavior, blockOpts)
        target[fn]("mousedown", this._onNativeBehavior, blockOpts)
        target[fn]("mouseup", this._onNativeBehavior, blockOpts)
        // target[fn]("auxclick", this._onNativeBehavior, blockOpts)
    }

    _bindEvents = () => this._toggleEvents(true)
    _unbindEvents = () => this._toggleEvents(false)

    _onNativeBehavior = (ev) => {
        if (this.isPaused) return
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

    _onPointerDown = (ev) => {
        if (this.isTracking || this.isPaused) return
        if (this.options.allowedPointerTypes && !this.options.allowedPointerTypes.includes(ev.pointerType)) return
        if (!this.options.triggerButtons.includes(ev.button)) return

        const payload = { originalEvent: ev, triggerButton: ev.button }
        if (this._invokeBailoutHook("onBeforeStart", payload) === false) {
            this._invokeHook("onSuppressed", payload)
            return
        }

        ev.target.setPointerCapture?.(ev.pointerId)

        this.isTracking = true
        this.isAborted = false
        this.hasMovedSinceStart = false
        this.currentTriggerButton = ev.button
        this.lastMoveTimestamp = ev.timeStamp

        const x = ev.clientX
        const y = ev.clientY
        const state = this.activeStrategy.initialize(x, y)
        this._invokeHook("onStart", { point: { x, y }, triggerButton: this.currentTriggerButton, originalEvent: ev })
        if (state.changed) {
            this._invokeHook("onPathChange", { paths: state.paths, newDirection: state.newDirection, triggerButton: this.currentTriggerButton })
        }
    }

    _onPointerMove = (ev) => {
        if (!this.isTracking || this.isAborted) return
        this.hasMovedSinceStart = true
        this.lastMoveTimestamp = ev.timeStamp

        const x = ev.clientX
        const y = ev.clientY
        const state = this.activeStrategy.processMove(x, y)

        this._sharedMovePayload.point.x = x
        this._sharedMovePayload.point.y = y
        this._sharedMovePayload.paths = state.paths
        this._sharedMovePayload.triggerButton = this.currentTriggerButton
        this._sharedMovePayload.originalEvent = ev
        this._invokeHook("onMove", this._sharedMovePayload)

        if (state.changed) {
            this._invokeHook("onPathChange", { paths: state.paths, newDirection: state.newDirection, triggerButton: this.currentTriggerButton })
        }
    }

    _onPointerUp = (ev) => {
        if (!this.isTracking || this.isAborted || ev.button !== this.currentTriggerButton) return

        ev.target.releasePointerCapture?.(ev.pointerId)
        this.isTracking = false

        const state = this.activeStrategy.processEnd(ev.clientX, ev.clientY)
        if (state.changed) {
            this._invokeHook("onPathChange", { paths: state.paths, newDirection: state.newDirection, triggerButton: this.currentTriggerButton })
        }
        this._invokeHook("onEnd", { paths: state.paths, gestureCode: state.paths.join(""), triggerButton: this.currentTriggerButton, originalEvent: ev })
        this.currentTriggerButton = null
    }

    _onPointerCancel = (ev) => {
        if (this.isTracking) {
            ev.target.releasePointerCapture?.(ev.pointerId)
            this.abort("systemCancel")
        }
    }
}

class PluginTimeout {
    id = "timeout"
    watchdogTimer = null

    constructor(options = {}) {
        this.options = { startTimeout: 1000, idleTimeout: 2000, pollInterval: 100, ...options }
    }

    updateConfig = (newConfig) => this.options = { ...this.options, ...newConfig }

    install = (engine) => {
        if (this.engine) this.uninstall()
        this.engine = engine
    }

    uninstall = () => {
        this._clearWatchdog()
        this.engine = null
    }

    _clearWatchdog = () => {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer)
            this.watchdogTimer = null
        }
    }

    _checkTimeout = () => {
        const elapsed = performance.now() - this.engine.getLastMoveTimestamp()
        if (this.engine.getHasMoved()) {
            if (this.options.idleTimeout > 0 && elapsed >= this.options.idleTimeout) {
                this.engine.abort("idleTimeout")
            }
        } else {
            if (this.options.startTimeout > 0 && elapsed >= this.options.startTimeout) {
                this.engine.abort("startTimeout")
            }
        }
    }

    onStart = () => {
        this._clearWatchdog()
        if (this.options.startTimeout > 0 || this.options.idleTimeout > 0) {
            this.watchdogTimer = setInterval(this._checkTimeout, this.options.pollInterval)
        }
    }

    onEnd = () => this._clearWatchdog()
    onAbort = () => this._clearWatchdog()
    onDestroyed = () => this._clearWatchdog()
}

class PluginSuppressor {
    id = "suppressor"

    constructor(options = {}) {
        this.options = {
            suppressorFn: (ev, triggerButton) => ev.altKey === true,
            ...options,
        }
    }

    updateConfig = (newConfig) => this.options = { ...this.options, ...newConfig }

    install = (engine) => {
        if (this.engine) this.uninstall()
        this.engine = engine
    }

    uninstall = () => {
        this.engine = null
    }

    onBeforeStart = (payload) => !this.options.suppressorFn?.(payload.originalEvent, payload.triggerButton)
}

class PluginVisualizer {
    id = "visualizer"
    currentColor = ""
    currentRect = { left: 0, top: 0, width: 0, height: 0 }
    rafId = null
    timeoutId = null

    constructor(el, options = {}) {
        if (!(el instanceof HTMLCanvasElement)) throw new TypeError(`Prop 'el' must be HTMLCanvasElement`)
        this.canvasEl = el
        this.ctx = el.getContext("2d")
        this.options = {
            lineWidth: 5,
            cleanupDelay: 200,
            minDrawDistance: 2,
            maxPoints: 1000,
            autoUpdateSize: true,
            colorFormatter: (paths, button) => "#7dcfff",
            ...options,
        }
        this.minDistSq = this.options.minDrawDistance ** 2
        this.pointBuffer = new Float32Array(this.options.maxPoints * 2)
        this.pointCount = 0
    }

    updateConfig = (newConfig = {}) => {
        this.options = { ...this.options, ...newConfig }
        if (newConfig.minDrawDistance !== undefined) {
            this.minDistSq = this.options.minDrawDistance ** 2
        }
        if (newConfig.maxPoints !== undefined && newConfig.maxPoints !== this.pointBuffer.length / 2) {
            this.pointBuffer = new Float32Array(this.options.maxPoints * 2)
            this._clearCanvas()
        }
    }

    install = (engine) => {
        if (this.engine) this.uninstall()
        this.engine = engine
    }

    uninstall = () => {
        this._clearTimers()
        this._clearCanvas()
        this.engine = null
    }

    _clearTimers = () => {
        if (this.rafId) cancelAnimationFrame(this.rafId)
        if (this.timeoutId) clearTimeout(this.timeoutId)
        this.rafId = this.timeoutId = null
    }

    _clearCanvas = () => {
        this.pointCount = 0
        this.ctx.setTransform(1, 0, 0, 1, 0, 0)
        this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height)
    }

    resize = (externalRect) => {
        const dpr = window.devicePixelRatio || 1
        this.currentRect = externalRect || this.canvasEl.getBoundingClientRect()
        this.canvasEl.width = this.currentRect.width * dpr
        this.canvasEl.height = this.currentRect.height * dpr
        this.ctx.scale(dpr, dpr)
    }

    _applyContextStyle = () => {
        this.ctx.lineWidth = this.options.lineWidth
        this.ctx.lineCap = this.ctx.lineJoin = "round"
        this.ctx.strokeStyle = this.currentColor
    }

    _renderBezier = () => {
        this.rafId = null
        const len = this.pointCount
        if (len < 6) return

        this.ctx.beginPath()
        this.ctx.moveTo(this.pointBuffer[0], this.pointBuffer[1])

        let midX, midY
        for (let i = 2; i < len - 2; i += 2) {
            const ctrlX = this.pointBuffer[i]
            const ctrlY = this.pointBuffer[i + 1]
            const nextX = this.pointBuffer[i + 2]
            const nextY = this.pointBuffer[i + 3]
            midX = (ctrlX + nextX) / 2
            midY = (ctrlY + nextY) / 2
            this.ctx.quadraticCurveTo(ctrlX, ctrlY, midX, midY)
        }
        this.ctx.stroke()

        this.pointBuffer[0] = midX
        this.pointBuffer[1] = midY
        this.pointBuffer[2] = this.pointBuffer[len - 2]
        this.pointBuffer[3] = this.pointBuffer[len - 1]
        this.pointCount = 4
    }

    onStart = (payload) => {
        if (!payload?.point) return
        this._clearTimers()

        this.canvasEl.classList.add("active")
        this.currentColor = this.options.colorFormatter(payload.paths || [], payload.triggerButton)
        if (this.options.autoUpdateSize) this.resize()
        this._applyContextStyle()

        this.pointCount = 0
        this.pointBuffer[this.pointCount++] = payload.point.x - this.currentRect.left
        this.pointBuffer[this.pointCount++] = payload.point.y - this.currentRect.top
    }

    onMove = (payload) => {
        if (!payload?.point) return
        if (this.pointCount >= this.pointBuffer.length - 1) return

        const x = payload.point.x - this.currentRect.left
        const y = payload.point.y - this.currentRect.top
        if (this.pointCount >= 4) {
            const dx = x - this.pointBuffer[this.pointCount - 2]
            const dy = y - this.pointBuffer[this.pointCount - 1]
            if (dx * dx + dy * dy < this.minDistSq) return
        }

        this.pointBuffer[this.pointCount++] = x
        this.pointBuffer[this.pointCount++] = y
        const newColor = this.options.colorFormatter(payload.paths || [], payload.triggerButton)
        if (this.currentColor !== newColor) {
            this.currentColor = newColor
            this.ctx.strokeStyle = newColor
        }

        if (!this.rafId) this.rafId = requestAnimationFrame(this._renderBezier)
    }

    onEnd = () => {
        this._clearTimers()
        if (this.pointCount >= 6) this._renderBezier()
        if (this.pointCount === 4) {
            this.ctx.beginPath()
            this.ctx.moveTo(this.pointBuffer[0], this.pointBuffer[1])
            this.ctx.lineTo(this.pointBuffer[2], this.pointBuffer[3])
            this.ctx.stroke()
        }

        this.canvasEl.classList.remove("active")
        this.timeoutId = setTimeout(() => {
            this._clearCanvas()
            this.timeoutId = null
        }, this.options.cleanupDelay)
    }

    onAbort = () => {
        this._clearTimers()
        this._clearCanvas()
        this.canvasEl.classList.remove("active")
    }
}

class PluginHUD {
    id = "hud"
    el = null
    hideElTimer = null

    constructor(el, options = {}) {
        if (!(el instanceof HTMLElement)) throw new TypeError(`Prop 'el' must be HTMLElement`)
        this.el = el
        this.options = {
            cleanupDelay: 200,
            textFormatter: (paths, button) => paths.join(""),
            colorFormatter: (paths, button) => "#7dcfff",
            ...options,
        }
    }

    updateConfig = (newConfig = {}) => this.options = { ...this.options, ...newConfig }

    install = (engine) => {
        if (this.engine) this.uninstall()
        this.engine = engine
    }

    uninstall = () => {
        if (this.hideElTimer) clearTimeout(this.hideElTimer)
        this.engine = null
    }

    onStart = () => {
        if (this.hideElTimer) clearTimeout(this.hideElTimer)
        this.el.classList.add("active")
    }

    onPathChange = (payload) => {
        this.el.textContent = this.options.textFormatter(payload.paths, payload.triggerButton)
        this.el.style.color = this.options.colorFormatter(payload.paths, payload.triggerButton)
    }

    onEnd = () => {
        this.el.classList.remove("active")
        this.hideElTimer = setTimeout(() => {
            this.el.textContent = ""
            this.el.style.removeProperty("color")
        }, this.options.cleanupDelay)
    }

    onAbort = () => {
        if (this.hideElTimer) clearTimeout(this.hideElTimer)
        this.el.classList.remove("active")
        this.el.textContent = ""
        this.el.style.removeProperty("color")
    }
}

class PluginSensory {
    id = "sensory"
    _lastPathLength = 0

    constructor(options = {}) {
        this.options = {
            enableAudio: true,
            enableHaptic: false,
            volFormatter: (paths, type) => {
                const vols = { tick: 0.1, success: 0.1, error: 0.05, abort: 0.08 }
                return vols[type] ?? 0.1
            },
            freqFormatter: (paths, type) => {
                if (type !== "tick") return 600
                const dir = paths[paths.length - 1]
                const pitchMap = { "↑": 1200, "↗": 1050, "→": 900, "↘": 750, "↓": 600, "↙": 450, "←": 300, "↖": 750 }
                return pitchMap[dir] || 600
            },
            vibrateFormatter: (paths, type) => {
                const vibes = { tick: 10, success: [15, 30, 20], error: [40, 30, 40], abort: [30, 40, 30] }
                return vibes[type] ?? 10
            },
            ...options,
        }
        const AudioContext = window.AudioContext || window.webkitAudioContext
        this.audioCtx = this.options.enableAudio && AudioContext ? new AudioContext() : null
    }

    updateConfig = (newConfig = {}) => this.options = { ...this.options, ...newConfig }

    install = (engine) => {
        if (this.engine) this.uninstall()
        this.engine = engine
    }

    uninstall = () => {
        this.engine = null
    }

    _initAudio = () => {
        if (this.audioCtx?.state === "suspended") {
            this.audioCtx.resume()
        }
    }

    _playTone = (freq, type, duration, vol) => {
        if (!this.audioCtx || !this.options.enableAudio || vol <= 0) return
        const osc = this.audioCtx.createOscillator()
        const gain = this.audioCtx.createGain()
        osc.type = type

        const now = this.audioCtx.currentTime
        osc.frequency.setValueAtTime(freq, now)
        gain.gain.setValueAtTime(0, now)
        gain.gain.linearRampToValueAtTime(vol, now + 0.005)
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration)

        osc.connect(gain)
        gain.connect(this.audioCtx.destination)
        osc.start(now)
        osc.stop(now + duration)
    }

    _vibrate = (pattern) => {
        if (this.options.enableHaptic) {
            navigator.vibrate?.(pattern)
        }
    }

    onStart = () => {
        this._initAudio()
        this._lastPathLength = 0
    }

    onPathChange = (payload) => {
        const paths = payload.paths
        if (!paths) return
        if (paths.length > this._lastPathLength) {
            this._lastPathLength = paths.length
            const type = "tick"
            const freq = this.options.freqFormatter(paths, type)
            const vol = this.options.volFormatter(paths, type)
            const vib = this.options.vibrateFormatter(paths, type)
            this._playTone(freq, "triangle", 0.02, vol)
            this._vibrate(vib)
        }
    }

    onAbort = () => {
        const paths = []
        const type = "abort"
        const vol = this.options.volFormatter(paths, type)
        const vib = this.options.vibrateFormatter(paths, type)
        this._playTone(150, "sawtooth", 0.15, vol)
        this._vibrate(vib)
    }

    playSuccess = (paths = []) => {
        this._initAudio()
        const type = "success"
        const vol = this.options.volFormatter(paths, type)
        const vib = this.options.vibrateFormatter(paths, type)
        this._playTone(600, "sine", 0.1, vol)
        setTimeout(() => this._playTone(900, "sine", 0.15, vol), 80)
        this._vibrate(vib)
    }

    playError = (paths = []) => {
        this._initAudio()
        const type = "error"
        const vol = this.options.volFormatter(paths, type)
        const vib = this.options.vibrateFormatter(paths, type)
        this._playTone(200, "square", 0.15, vol)
        this._vibrate(vib)
    }
}

class PluginActionManager {
    id = "actionManager"
    actionRegistry = new Map()
    lastTriggerTimes = new WeakMap()
    static BUTTON_MAP = { middle: 1, right: 2, x1: 3, x2: 4 }

    constructor({ actions = [], ...options } = {}) {
        this.options = {
            globalCooldown: 0,
            onBeforeAction: (context) => true,
            onAfterAction: (context, result) => null,
            onMissed: (context) => null,
            onCooldown: (context, remain) => console.warn(`[Action Cooldown] ${context.action?.name || "Unknown"} wait ${remain}ms.`),
            onConditionFailed: (context) => null,
            onError: (context, err) => console.error(`[Action Error] ${context.action?.name || "Unknown"}:`, err),
            ...options,
        }
        actions.forEach(action => this.register(action))
    }

    install = (engine) => {
        if (this.engine) this.uninstall()
        this.engine = engine
    }

    uninstall = () => {
        this.engine = null
    }

    _getMatchKey = ({ button, path }) => {
        if (!path || typeof path !== "string") {
            throw new TypeError(`[Gesture Error] Action requires a valid 'path' string.`)
        }
        if (button == null) return path

        const code = typeof button === "number" ? button : this.constructor.BUTTON_MAP[String(button).toLowerCase()]
        if (code === undefined) {
            throw new TypeError(`[Gesture Error] Invalid button "${button}".`)
        }
        return `${code}:${path}`
    }

    register = (actionDef) => {
        if (typeof actionDef.execute !== "function") {
            throw new TypeError(`[Gesture Error] Action missing 'execute' function.`)
        }
        this.actionRegistry.set(this._getMatchKey(actionDef), actionDef)
        return this
    }

    unregister = (actionDef) => {
        this.actionRegistry.delete(this._getMatchKey(actionDef))
        return this
    }

    _resolveAction = (button, code) => {
        if (!code) return null
        return this.actionRegistry.get(`${button}:${code}`) || this.actionRegistry.get(code) || null
    }

    hasMatchedAction = (button, code) => !!this._resolveAction(button, code)

    onEnd = (payload) => {
        const action = this._resolveAction(payload.triggerButton, payload.gestureCode)
        const context = { payload, action, engine: this.engine, manager: this }
        if (!context.action) {
            return this.options.onMissed(context)
        }
        this._executePipeline(context)
    }

    _executePipeline = (context) => {
        const { action } = context
        const now = Date.now()
        const cooldown = action.cooldown ?? this.options.globalCooldown
        if (cooldown > 0) {
            const lastTime = this.lastTriggerTimes.get(action) || 0
            const remain = cooldown - (now - lastTime)
            if (remain > 0) {
                return this.options.onCooldown(context, remain)
            }
        }
        if (typeof action.condition === "function" && !action.condition(context)) {
            return this.options.onConditionFailed(context)
        }
        try {
            if (this.options.onBeforeAction(context) === false) return
            this.lastTriggerTimes.set(action, now)
            const result = action.execute(context)
            this.options.onAfterAction(context, result)
        } catch (error) {
            this.options.onError(context, error)
        }
    }
}

class MouseGesturesPlugin extends BasePlugin {
    styleTemplate = () => true

    html = () => {
        const canvasEl = this.config.ENABLE_VISUALIZER ? `<canvas id="plugin-mouse-gestures-visualizer"></canvas>` : ""
        const hudEl = this.config.ENABLE_HUD ? `<div id="plugin-mouse-gestures-hud"></div>` : ""
        return canvasEl + hudEl
    }

    initEngine = () => {
        const BUTTONS = ["left", "middle", "right", "x1", "x2"]
        const BUTTON_NAMES = this.i18n.array(BUTTONS, "$option.GESTURES.button.")
        const ACTIONS = new Map(
            this.config.GESTURES
                .filter(g => g.enable && BUTTONS.includes(g.button) && typeof g.execute === "string" && /^[→←↑↓↘↙↗↖]+$/u.test(g.path))
                .map(g => {
                    const fn = eval(g.execute)
                    if (typeof fn !== "function") return null
                    const key = `${BUTTONS.indexOf(g.button)}:${g.path}`
                    return [key, { ...g, execute: fn }]
                })
                .filter(Boolean),
        )
        const getTriggerButtons = (triggers) => triggers.map(btn => BUTTONS.indexOf(btn)).filter(x => x !== -1)
        const getSuppressFn = () => {
            const modifier = this.config.SUPPRESSION_KEY
            if (!modifier) return null
            const key = `${modifier}Key`
            return (ev) => ev[key] === true
        }
        const getStrategy = (name) => {
            const isLinear = this.config.HYSTERESIS === 0
            const strategies = isLinear
                ? { fourWay: Strategy4Way, eightWay: Strategy8Way, adaptive: StrategyAdaptive }
                : { fourWay: Strategy4WayHysteresis, eightWay: Strategy8WayHysteresis, adaptive: StrategyAdaptiveHysteresis }
            const cfg = { macroRadius: this.config.MACRO_RADIUS, tailRadius: this.config.TAIL_RADIUS }
            const finalCfg = isLinear ? cfg : { ...cfg, hysteresis: this.config.HYSTERESIS }
            return new strategies[name](finalCfg)
        }
        const colorFormatter = (paths, btn) => this.config.DEFAULT_COLOR[BUTTONS[btn]] || "#7dcfff"

        const engine = new GestureEngine({
            triggerButtons: getTriggerButtons(this.config.TRIGGER_BUTTONS),
            strategy: getStrategy(this.config.STRATEGY),
            allowedPointerTypes: ["mouse"],
        })

        engine.use(new PluginTimeout({ startTimeout: this.config.START_TIMEOUT, idleTimeout: this.config.IDLE_TIMEOUT }))
            .use(new PluginSuppressor({ suppressorFn: getSuppressFn() }))
        if (this.config.ENABLE_VISUALIZER) {
            engine.use(new PluginVisualizer(document.getElementById("plugin-mouse-gestures-visualizer"), {
                lineWidth: this.config.TRAJECTORY_LINE_WIDTH,
                colorFormatter,
            }))
        }
        if (this.config.ENABLE_HUD) {
            engine.use(new PluginHUD(document.getElementById("plugin-mouse-gestures-hud"), {
                colorFormatter,
                textFormatter: (paths, btn) => {
                    if (paths.length === 0) return ""
                    const code = paths.join("")
                    return ACTIONS.get(`${btn}:${code}`)?.name || `[${BUTTON_NAMES[btn]}] ${code}`
                },
            }))
        }
        if (this.config.ENABLE_SENSORY) {
            engine.use(new PluginSensory())
        }
        engine.use(new PluginActionManager({ actions: [...ACTIONS.values()], globalCooldown: this.config.COOLDOWN }))

        return engine
    }

    process = () => {
        this.engine = this.initEngine()
    }

    getDynamicActions = () => [
        { act_value: "toggle_state", act_state: !this.engine.isPaused, act_name: this.i18n.t("act.toggle_state") },
    ]

    call = (action) => {
        if (action === "toggle_state") {
            const fn = this.engine.isPaused ? "resume" : "pause"
            this.engine[fn]()
        }
    }
}

module.exports = {
    plugin: MouseGesturesPlugin,
}
