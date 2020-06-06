const now = () => performance.now() / 1000
const formatSeconds = seconds => seconds.toFixed(2)

function formatAction(action) {
  if (action.type === 'mouse') {
    return `MB${action.button}`
  }
  const modifiers = [
    ...(action.ctrl ? ['Ctrl'] : []),
    ...(action.alt ? ['Alt'] : []),
    ...(action.shift ? ['Shift'] : [])
  ]
  const key = action.key === ' ' ? 'Space' : action.key.toUpperCase()
  return modifiers
    .map(mod => `<span class="modifier">${mod}</span>`)
    .concat(key)
    .join('')
}

const ATTACKING = 0,
  ATTACKING_COLOR = "rgba(123,198,255,0.4)",
  ATTACKING_ICON = "gps_fixed",
  MOVING = 1,
  MOVING_COLOR = "rgba(255,255,255,0.15)",
  MOVING_ICON = "directions_run",
  DEFAULT_KEYBINDS = {
    moveBind: { type: "mouse", button: 2 },
    attackBind: { type: "key", key: 'a', shift: false, ctrl: false, alt: false },
  },
  DEFAULT_STATS = {
    baseAS: 0.658,
    totalAS: 0.658,
    windup: .2193,
    windupMod: 1
  }

class Game {
  constructor() {
    this.settings = {
      ...DEFAULT_STATS,
      ...DEFAULT_KEYBINDS
    }
    // load settings from localStorage
    if (localStorage['settings'])
      this.settings = JSON.parse(localStorage['settings'])

    this.loopBind = this.loop.bind(this)

    // State Variables
    this.action = null
    this.canStart = false
    this.playing = false
    this.cancelledAt = false
    this.lostTime = 0
    this.mousePos = { x: 0, y: 0 }
    this.editingBind = false

    this.lastHead = 0;

    // Elements
    this.$timeSliderHead = $("#time-slider-head")
    this.$timeSliderWindup = $("#time-slider-windup")
    this.$timerTotal = $("#timer-total")
    this.$timerLost = $("#timer-lost")
    this.$modeIndicator = $("#mode-indicator .material-icons")
    this.$attackTarget = $("#attack-target")
    this.$settingsContainer = $("#settings-container")

    this.ctx = $("#time-slider-canvas")[0].getContext("2d")

    this.reset()
    this.bindEvents()
    this.updateInputs()
  }

  /**
   * Reflect the data from this.settings onto the input fields.
   */
  updateInputs() {
    for (let [key, value] of Object.entries(this.settings)) {
      if (typeof value !== 'object')
        $(`[name=${key}]`)
          .val(this.settings[key])
      else {
        const elm = $(`.key-input[data-setting=${key}]`)
        elm.toggleClass('focused', this.editingBind === key)
        elm.find('.label')
          .html(formatAction(value))
      }
    }
    localStorage['settings'] = JSON.stringify(this.settings)
    this.updateTimeSlider()
  }

  /**
   * Calculate the attack/windup time constants and update the size of the time slider bar.
   * See https://leagueoflegends.fandom.com/wiki/Basic_attack#Attack_speed for math.
   */
  updateTimeSlider() {
    this.cAttackTime = 1 / this.settings.totalAS // current attack time
    let bWindupTime = 1 / this.settings.baseAS * this.settings.windup, // base windup time
      dWindupTime = (this.cAttackTime * this.settings.windup) - bWindupTime; // diff between bWindupTime and cWindupTime, assuming mod = 1

    this.cWindupTime = dWindupTime * this.settings.windupMod + bWindupTime;

    let cWindup = this.cWindupTime / this.cAttackTime

    this.$timeSliderWindup.css({ width: `${cWindup * 100}%` })
  }

  reset() {
    this.$timeSliderHead.css({ left: 0 })
    this.updateTimeSlider()

    this.action = null
    this.playing = false
    this.cancelledAt = false
    this.lostTime = 0
    this.lastChange = false
  }

  /**
   * Called when user first attacks target area to start the game.
   */
  start() {
    this.reset()
    this.startTime = now()
    this.playing = true
    this.startAttack()
    requestAnimationFrame(this.loopBind)
  }

  /**
   * Game loop.
   * Move playhead and update attackTime
   */
  loop() {
    if (!this.playing) {
      this.$modeIndicator.text('')
      return
    }

    // Update UI
    let dLost = 0
    if (this.action === ATTACKING || this.cancelledAt !== false) {
      dLost = Math.max(0, now() - this.lastChange)
    } else if (this.action === MOVING && this.attackTime > this.cAttackTime) {
      dLost = this.attackTime - this.cAttackTime
    }
    this.$timerTotal.text(formatSeconds(now() - this.startTime))
    this.$timerLost.text(formatSeconds(this.lostTime + dLost))
    this.$modeIndicator.text(this.action === ATTACKING ? ATTACKING_ICON : MOVING_ICON)

    let attackTime = this.attackTime = now() - this.lastAttackStart

    if (this.cancelledAt !== false) {
      attackTime = this.attackTime = 0
      this.lastHead = 0
    }

    if (attackTime > this.cAttackTime) {
      // Start a new attack
      if (this.action === ATTACKING) {
        this.startAttack()
      } else {
        this.lastChange = this.lastAttackStart + this.cAttackTime
      }
    }

    if (attackTime <= this.cAttackTime) {
      // Move playhead
      let attackPosition = attackTime / this.cAttackTime
      this.$timeSliderHead.css({ left: `${attackPosition * 100}%` })

      // Draw on canvas
      let pos = Math.floor(attackTime / this.cAttackTime * 601)
      this.ctx.save()
      this.ctx.fillStyle = this.action === ATTACKING ? ATTACKING_COLOR : MOVING_COLOR
      this.ctx.fillRect(this.lastHead, 0, pos - this.lastHead, 4)
      this.ctx.restore()
      this.lastHead = pos
    } else {
      this.$timeSliderHead.css({ left: `0%` })
    }

    requestAnimationFrame(this.loopBind)
  }

  /**
   * Accumulate the lost time and display in a play hint.
   * @param {number} time
   * @param cancelled
   */
  addLostTime(time, cancelled = false) {
    this.lostTime += time
    let hint = $("<div>")
      .addClass('time-hint')
      .css({
        top: this.mousePos.y,
        left: this.mousePos.x
      })

    if (cancelled)
      hint
        .text(`CANCELLED`)
        .toggleClass('cancelled', cancelled)
    else
      hint
        .text(`-${time.toFixed(2)}s`)
    $("#hints").append(hint)
    setTimeout(() => hint.remove(), 1000)
  }

  startAttack() {
    this.ctx.clearRect(0, 0, 600, 4)
    if (this.lastChange) {
      let lostTime = now() - this.lastChange
      this.addLostTime(lostTime)
    }

    this.lastAttackStart = now()
    this.lastHead = 0
    this.lastChange = this.cWindupTime + now()
    this.action = ATTACKING
  }

  // Actions
  onAttack() {
    // Start game if not started
    if (this.playing === false) {
      if (this.canStart)
        this.start()
      return
    }

    if (this.action === ATTACKING)
      return

    if (this.attackTime > this.cAttackTime) {
      // Was waiting for attack command
      this.startAttack()
    } else {
      if (this.cancelledAt === false) {
        // Not a cancelled attack
        this.lastChange = now()
        this.action = ATTACKING
      } else {
        // Is a cancelled attack
        this.startAttack()
        this.cancelledAt = false
      }
    }
  }

  onMove() {
    // Do nothing of game not started
    if (this.playing === false)
      return

    // Do nothing if already moving
    if (this.action === MOVING)
      return

    if (this.attackTime < this.cWindupTime) {
      // Attack was cancelled.
      this.cancelledAt = now()
      let lostTime = this.attackTime
      this.addLostTime(lostTime, true)
    } else {
      // Normal movement command
      let lostTime = now() - this.lastChange
      this.addLostTime(lostTime)
    }
    this.action = MOVING
    this.lastChange = now()
  }

  // Event Binding
  bindEvents() {
    // Store mouse pos for hints
    $(window).on('mousemove', e => {
      this.mousePos.x = e.pageX
      this.mousePos.y = e.pageY
    })
      .on('keydown', this.handleKeydown.bind(this)) // bind keyboard

    this.$settingsContainer
      .on('contextmenu', () => false)
    // mouse events only when binding
      .on('mousedown', (e) => this.editingBind ? this.handleMousedown(e) : true)

    this.$attackTarget
      .on('contextmenu', () => false)
      .on('mouseenter', () => this.canStart = true) // can only start if mouse is in target area.
      .on('mousemove', () => this.canStart = true) // ^^^
      .on('mousedown', this.handleMousedown.bind(this)) // bind mouse
      .on('mouseleave', () => {
        // stop playing on mouse leave
        this.canStart = false
        this.playing = false
      })

    // Events for settings panel
    for (let [key, value] of Object.entries(this.settings)) {
      if (typeof value !== 'object') {
        // For a normal input
        $(`[name=${key}]`).on('change', e => {
          this.settings[key] = parseFloat(e.target.value)
          this.updateInputs()
        })
      } else {
        // For a fancy keybind input
        const elm = $(`.key-input[data-setting=${key}]`)
        elm.find('.key-input-button').on('click', () => {
          this.editingBind = this.editingBind === key ? false : key

          $('.key-input.focused').removeClass('focused')
          elm.toggleClass('focused', this.editingBind === key)
        })
      }
    }

    $('#reset-stats').on('click', () => {
      if (!confirm('Are you sure you want to reset the champion stats?'))
        return

      this.settings = {
        ...this.settings,
        ...DEFAULT_STATS,
      }
      this.updateInputs()
    })

    $('#reset-keybinds').on('click', () => {
      if (!confirm('Are you sure you want to reset the keybinds?'))
        return

      this.settings = {
        ...this.settings,
        ...DEFAULT_KEYBINDS
      }
      this.updateInputs()
    })
  }

  /**
   * Keydown handler
   * @param {KeyboardEvent} event
   */
  handleKeydown(event) {
    let action = {
      type: "key", key: event.key.toLowerCase(),
      shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey
    }
    if (!action.key.match(/^[a-z ]$/))
      return // not a alphabet/space
    if (this.callHandler(action))
      event.preventDefault()
  }

  /**
   *
   * @param {MouseEvent} event
   */
  handleMousedown(event) {
    let action = { type: "mouse", button: event.button }
    if (this.callHandler(action)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  callHandler(action) {
    if (this.editingBind) {
      this.settings[this.editingBind] = action
      this.editingBind = false
      this.updateInputs()
      return true
    }
    if (this.isMatchingAction(action, this.settings.moveBind)) {
      return this.onMove(), true
    }

    if (this.isMatchingAction(action, this.settings.attackBind)) {
      return this.onAttack(), true
    }

    return false
  }

  isMatchingAction(action, requirement) {
    return JSON.stringify(action) === JSON.stringify(requirement)
  }
}

const game = new Game

$("input, textarea, button").on('keydown', e => e.stopPropagation())
// $(window).on('keydown', e => {
//   if (e.keyCode == 65 /* A */) {
//     game.onAttack()
//   }
//   if (e.keyCode == 83 /* S */) {
//     game.onMove()
//   } 
// })