package nl.timvanbergen.skitta.glass.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderNode
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Choreographer
import android.view.HapticFeedbackConstants
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.customview.widget.ExploreByTouchHelper
import nl.timvanbergen.skitta.glass.GlassBar
import nl.timvanbergen.skitta.glass.GlassMenuAnchor
import kotlin.math.min

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class GlassMenuOverlay(
  context: Context,
  private val root: ViewGroup,
) : View(context), ViewTreeObserver.OnPreDrawListener, Choreographer.FrameCallback {
  private val density = resources.displayMetrics.density
  private val limits = Rect()
  private val location = IntArray(2)
  private val supportsGlass = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
  private val backdrop: RenderNode? = if (supportsGlass) RenderNode("GlassMenu.backdrop") else null
  private var session: GlassMenuSession? = null
  private var framePending = false
  private var lastFrameNanos = 0L
  private val accessibility = MenuAccessibility()
  var anchor: GlassMenuAnchor? = null
  var bar: GlassBar? = null
  private val restRect = RectF()
  private val tabRect = RectF()
  private var backCallback: Any? = null
  private var animationScale = 1f
  private var startupFrames = 0
  private var warmed = false

  init {
    setWillNotDraw(false)
    isClickable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    ViewCompat.setAccessibilityDelegate(this, accessibility)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(this)
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnPreDrawListener(this)
    finishSession()
    Choreographer.getInstance().removeFrameCallback(this)
    framePending = false
    super.onDetachedFromWindow()
  }

  override fun onPreDraw(): Boolean {
    // Geen glas in beeld: niets opnemen, zodat de agenda er geen hinder van heeft.
    if (hasGlass() && backdropChanged()) invalidate()
    return true
  }

  private fun hasGlass() = session != null || bar?.isVisible == true

  /** De balk is veranderd: opnieuw tekenen en de nieuwe tabbladen melden aan TalkBack. */
  fun barChanged() {
    updateAccessibility()
    accessibility.invalidateRoot()
    requestFrame()
    invalidate()
  }

  private fun updateAccessibility() {
    importantForAccessibility = if (hasGlass()) IMPORTANT_FOR_ACCESSIBILITY_YES else IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  fun refreshItems() {
    session?.refreshItems()
  }

  private fun backdropChanged(): Boolean {
    for (index in 0 until root.childCount) {
      val child = root.getChildAt(index)
      if (child !== this && child.isDirty) return true
    }
    return false
  }

  override fun onDraw(canvas: Canvas) {
    limits.set(0, 0, width, height)
    val active = session
    if (!supportsGlass || !canvas.isHardwareAccelerated) {
      active?.drawFallback(canvas)
      return
    }
    if (!hasGlass()) {
      warmShaders(canvas)
      return
    }
    drawGlass(canvas, active)
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun warmShaders(canvas: Canvas) {
    if (warmed) return
    warmed = true
    anchor?.renderer(density)?.warmPipelines(canvas)
  }

  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun drawGlass(canvas: Canvas, active: GlassMenuSession?) {
    val node = backdrop ?: return
    node.setPosition(limits)
    // Eigen laag op volledige grootte: anders denkt de WebView dat alleen het stukje onder
    // het glas zichtbaar is en tekent hij de rest van de pagina niet meer.
    node.setUseCompositingLayer(true, null)
    val recording = node.beginRecording(width, height)
    recording.drawColor(if ((active?.anchor ?: bar?.surfaces?.first())?.isDark() != false) Color.BLACK else Color.WHITE)
    root.background?.draw(recording)
    for (index in 0 until root.childCount) {
      val child = root.getChildAt(index)
      if (child !== this && child.visibility == VISIBLE && child.id != android.R.id.statusBarBackground &&
        child.id != android.R.id.navigationBarBackground
      ) child.draw(recording)
    }
    node.endRecording()

    bar?.takeIf { it.isVisible }?.surfaces?.forEach { drawRestingAnchor(canvas, node, it) }
    active?.draw(canvas, node, limits)
  }

  private fun drawRestingAnchor(canvas: Canvas, node: RenderNode, anchor: GlassMenuAnchor) {
    if (anchor.width == 0 || anchor.height == 0) return
    val opacity = anchor.opacity
    if (opacity <= 0f) return
    val state = anchor.surfaceState
    anchorRect(anchor, restRect)
    state.incoming.set(restRect)
    state.captureBounds.set(restRect)
    state.captureBounds.inset(-RestCaptureMargin * density, -RestCaptureMargin * density)
    state.lockedFieldStep = 0f
    anchor.jelly.deformControl(state.incoming, density, anchor.triggerConfig.jelly)
    val radius = anchor.cornerRadiusPx(state.incoming)
    state.radiusX = radius
    state.radiusY = radius
    state.hasSource = false
    state.smoothing = 0f
    state.lensHeight = 0f
    state.lensAmount = 0f
    state.materialProgress = 0f
    state.surfaceOpacity = opacity
    state.dark = anchor.isDark()
    state.config = anchor.config
    state.trigger = anchor.triggerConfig
    anchor.applyLight(state, restRect, 1f)
    val renderer = anchor.renderer(density)
    renderer.prepare(state)
    renderer.drawGlass(canvas, node, state, limits)
    if (renderer.warmPipelines(canvas)) post { invalidate() }
    val content = anchor.recordContent()
    content.alpha = opacity
    content.setScaleX(state.incoming.width() / anchor.width)
    content.setScaleY(state.incoming.height() / anchor.height)
    val save = canvas.save()
    canvas.translate(state.incoming.left, state.incoming.top)
    canvas.drawRenderNode(content)
    canvas.restoreToCount(save)
  }

  fun anchorRect(anchor: GlassMenuAnchor, out: RectF) {
    getLocationInWindow(location)
    out.set(anchor.placement)
    out.offset(-location[0].toFloat(), -location[1].toFloat())
  }

  fun open(anchor: GlassMenuAnchor) {
    finishSession()
    session = GlassMenuSession(this, anchor, density, supportsGlass, null, width, height, insets())
    startupFrames = StartupFrames
    isFocusable = true
    isFocusableInTouchMode = true
    requestFocus()
    registerBack()
    updateAccessibility()
    accessibility.invalidateRoot()
    requestFrame()
    invalidate()
  }

  private fun insets(): Rect {
    val window = rootWindowInsets ?: return Rect()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val insets = window.getInsets(WindowInsets.Type.systemBars())
      return Rect(insets.left, insets.top, insets.right, insets.bottom)
    }
    @Suppress("DEPRECATION")
    return Rect(window.systemWindowInsetLeft, window.systemWindowInsetTop, window.systemWindowInsetRight, window.systemWindowInsetBottom)
  }

  fun requestClose() {
    val active = session ?: return
    if (!active.expanded) return
    active.close()
    releaseInput()
    requestFrame()
  }

  private fun releaseInput() {
    clearFocus()
    isFocusable = false
    isFocusableInTouchMode = false
    unregisterBack()
    updateAccessibility()
  }

  private fun finishSession() {
    val active = session ?: return
    active.release()
    session = null
    releaseInput()
    invalidate()
  }

  fun requestFrame() {
    if (framePending || !isAttachedToWindow) return
    framePending = true
    lastFrameNanos = 0L
    animationScale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
    Choreographer.getInstance().postFrameCallback(this)
  }

  override fun doFrame(frameTimeNanos: Long) {
    framePending = false
    val scale = animationScale
    val interval = 1f / (display?.refreshRate ?: DefaultRefreshRate).coerceAtLeast(MinimumRefreshRate)
    val elapsed = if (lastFrameNanos == 0L) interval / 2f else (frameTimeNanos - lastFrameNanos) / 1_000_000_000f
    val limit = interval * (if (startupFrames > 0) 1f else MaxSkippedFrames)
    startupFrames = (startupFrames - 1).coerceAtLeast(0)
    val seconds = if (scale == 0f) 10f else min(elapsed, limit) / scale
    lastFrameNanos = frameTimeNanos
    var running = false
    bar?.let { current ->
      current.tick(seconds)
      for (surface in current.surfaces) {
        surface.jelly.advance(seconds)
        if (!surface.jelly.isSettled) running = true
      }
      if (current.needsFrame) running = true
    }
    val active = session
    if (active != null) {
      val speed = active.anchor.config.speed
      if (active.tick(seconds * speed)) finishSession() else running = running || active.needsFrame
    }
    invalidate()
    if (running) {
      framePending = true
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (oldw != 0 && oldh != 0) finishSession()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val active = session
    if (active == null || !active.expanded) return bar?.onTouch(event) == true
    active.onTouch(event)
    requestFrame()
    return true
  }

  fun hapticTick() {
    performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
  }

  fun hapticConfirm() {
    performHapticFeedback(HapticFeedbackConstants.CONFIRM)
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (session?.expanded == true && event.keyCode == KeyEvent.KEYCODE_BACK) {
      if (event.action == KeyEvent.ACTION_UP) requestClose()
      return true
    }
    return super.dispatchKeyEvent(event)
  }

  private fun registerBack() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || backCallback != null) return
    val dispatcher = findOnBackInvokedDispatcher() ?: return
    val callback = OnBackInvokedCallback { requestClose() }
    dispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY, callback)
    backCallback = callback
  }

  private fun unregisterBack() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val callback = backCallback as? OnBackInvokedCallback ?: return
    findOnBackInvokedDispatcher()?.unregisterOnBackInvokedCallback(callback)
    backCallback = null
  }

  override fun dispatchHoverEvent(event: MotionEvent): Boolean =
    accessibility.dispatchHoverEvent(event) || super.dispatchHoverEvent(event)

  private inner class MenuAccessibility : ExploreByTouchHelper(this) {
    override fun getVirtualViewAt(x: Float, y: Float): Int {
      val active = session
      if (active != null && active.expanded) return active.rowIndexAt(x, y).takeIf { it >= 0 } ?: INVALID_ID
      val current = bar?.takeIf { it.isVisible } ?: return INVALID_ID
      if (current.addRect().contains(x, y)) return BarAddId
      for (index in 0 until current.tabCount()) {
        current.tabRect(index, tabRect)
        if (tabRect.contains(x, y)) return BarTabId + index
      }
      return INVALID_ID
    }

    override fun getVisibleVirtualViews(ids: MutableList<Int>) {
      val active = session
      if (active != null && active.expanded) {
        active.accessibleRows().forEach { ids.add(it.index) }
        return
      }
      val current = bar?.takeIf { it.isVisible } ?: return
      for (index in 0 until current.tabCount()) ids.add(BarTabId + index)
      ids.add(BarAddId)
    }

    override fun onPopulateNodeForVirtualView(id: Int, node: AccessibilityNodeInfoCompat) {
      val current = bar
      if (id >= BarAddId && current != null) {
        val index = id - BarTabId
        val known = id == BarAddId || index in 0 until current.tabCount()
        if (id != BarAddId && known) current.tabRect(index, tabRect) else tabRect.set(current.addRect())
        node.text = if (id == BarAddId || !known) "Nieuwe afspraak" else current.tabTitle(index)
        node.className = "android.widget.Button"
        node.isClickable = true
        node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
        @Suppress("DEPRECATION")
        node.setBoundsInParent(Rect(tabRect.left.toInt(), tabRect.top.toInt(), tabRect.right.toInt(), tabRect.bottom.toInt()))
        return
      }
      val row = session?.accessibleRows()?.firstOrNull { it.index == id }
      node.text = row?.item?.title ?: ""
      node.className = "android.widget.Button"
      node.isCheckable = row?.item?.checked != null
      node.isChecked = row?.item?.checked == true
      node.isEnabled = row?.selectable == true
      node.isClickable = row?.selectable == true
      if (row?.selectable == true) node.addAction(AccessibilityNodeInfoCompat.ACTION_CLICK)
      val bounds = session?.screenRect(row) ?: Rect(0, 0, 1, 1)
      @Suppress("DEPRECATION")
      node.setBoundsInParent(bounds)
    }

    override fun onPerformActionForVirtualView(id: Int, action: Int, arguments: Bundle?): Boolean {
      if (action != AccessibilityNodeInfoCompat.ACTION_CLICK) return false
      val current = bar
      if (id >= BarAddId && current != null) {
        if (id == BarAddId) current.tapAdd() else current.tapTab(id - BarTabId)
        return true
      }
      session?.select(id) ?: return false
      return true
    }
  }

  companion object {
    private const val RestCaptureMargin = 16f
    private const val BarAddId = 1000
    private const val BarTabId = 1001
    private const val DefaultRefreshRate = 60f
    private const val MinimumRefreshRate = 30f
    private const val MaxSkippedFrames = 2.5f
    private const val StartupFrames = 4

  }
}
