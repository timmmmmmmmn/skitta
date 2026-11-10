package nl.timvanbergen.skitta.glass

import android.content.res.Resources
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.text.TextPaint
import android.view.MotionEvent
import androidx.annotation.RequiresApi
import nl.timvanbergen.skitta.glass.content.GlassIcons
import nl.timvanbergen.skitta.glass.motion.GlassSpring
import nl.timvanbergen.skitta.glass.motion.GlassSpringSpec
import nl.timvanbergen.skitta.glass.overlay.GlassMenuOverlay
import nl.timvanbergen.skitta.glass.records.GlassTriggerConfigRecord

/** De zwevende navigatie: een glazen balk met tabbladen en een glazen +-knop. De pagina geeft de plek door. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
class GlassBar internal constructor(private val overlay: GlassMenuOverlay, resources: Resources) {
  class Tab(val id: String, val title: String, val icon: String)

  private val density = resources.displayMetrics.density
  private val pill = GlassMenuAnchor(resources).apply {
    glass = true
    cornerRadius = Radius
    content = ::drawPill
  }
  private val add = GlassMenuAnchor(resources).apply {
    glass = true
    cornerRadius = Radius
    triggerConfig = GlassTriggerConfigRecord(tintColor = Color.valueOf(0f, .62f, .89f), tintOpacity = .78f)
    content = ::drawAdd
  }
  private val fade = GlassSpring(.004f, .05f)
  private val slide = GlassSpring(.3f, 6f)
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
  private val label = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    textAlign = Paint.Align.CENTER
    textSize = 10.5f * this@GlassBar.density
    letterSpacing = .04f
  }
  private val iconMatrix = Matrix()
  private val iconPath = Path()
  private val plate = RectF()
  private var typefaceReady = false
  private var tabs: List<Tab> = emptyList()
  private var active = ""
  private var onTap: (String) -> Unit = {}
  private var dark = false
  private var pressing: GlassMenuAnchor? = null
  private var pressedTab = -1

  internal val surfaces: List<GlassMenuAnchor> = listOf(pill, add)
  val isVisible get() = fade.value > .001f && pill.width > 0
  val needsFrame get() = !fade.isSettled || !slide.isSettled

  fun update(pillRect: RectF, addRect: RectF, tabs: List<Tab>, active: String, dark: Boolean, visible: Boolean, onTap: (String) -> Unit) {
    if (!typefaceReady) {
      typefaceReady = true
      label.typeface = runCatching {
        Typeface.create(Typeface.createFromAsset(overlay.context.assets, "fonts/Inter-Regular.ttf"), 700, false)
      }.getOrDefault(Typeface.DEFAULT_BOLD)
    }
    val first = pill.width == 0
    pill.placement.set(pillRect)
    add.placement.set(addRect)
    pill.dark = dark
    add.dark = dark
    // Iets meer waas en tint dan los glas, anders vecht de tekst eronder met de labels.
    val shade = if (dark) .1f else 1f
    pill.triggerConfig = GlassTriggerConfigRecord(blur = 5f, tintColor = Color.valueOf(shade, shade, shade), tintOpacity = if (dark) .5f else .55f)
    this.dark = dark
    this.tabs = tabs
    this.onTap = onTap
    this.active = active
    val spot = cellLeft(tabs.indexOfFirst { it.id == active }.coerceAtLeast(0))
    if (first) slide.reset(spot) else slide.target(spot, Slide)
    if (first) fade.reset(if (visible) 1f else 0f) else fade.target(if (visible) 1f else 0f, Fade)
    applyOpacity()
    overlay.barChanged()
  }

  fun hide() {
    if (pill.width == 0) return
    fade.reset(0f)
    applyOpacity()
    pill.placement.setEmpty()
    add.placement.setEmpty()
    overlay.barChanged()
  }

  fun tick(seconds: Float) {
    fade.advance(seconds)
    slide.advance(seconds)
    applyOpacity()
  }

  private fun applyOpacity() {
    val opacity = fade.value.coerceIn(0f, 1f)
    pill.opacity = opacity
    add.opacity = opacity
  }

  private fun cellLeft(index: Int): Float {
    val inset = Inset * density
    return inset + index * (pill.placement.width() - inset * 2f) / tabs.size.coerceAtLeast(1)
  }

  private fun tabAt(x: Float): Int {
    val inset = Inset * density
    val cell = (pill.placement.width() - inset * 2f) / tabs.size.coerceAtLeast(1)
    return ((x - inset) / cell).toInt().coerceIn(0, tabs.lastIndex)
  }

  /** True als de vinger op de balk is begonnen; anders gaat de aanraking naar de pagina. */
  fun onTouch(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      if (!isVisible || fade.value < .5f) return false
      pressing = surfaces.firstOrNull { it.placement.contains(event.x, event.y) } ?: return false
    }
    val surface = pressing ?: return false
    val x = event.x - surface.placement.left
    val y = event.y - surface.placement.top
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        surface.jelly.down(x, y)
        if (surface === pill) pressedTab = tabAt(x)
      }
      MotionEvent.ACTION_MOVE -> {
        surface.jelly.move(x, y)
        if (surface === pill && tabAt(x) != pressedTab) {
          pressedTab = tabAt(x)
          overlay.hapticTick()
        }
      }
      MotionEvent.ACTION_UP -> {
        surface.jelly.release()
        val slop = Slop * density
        val inside = RectF(surface.placement).apply { inset(-slop, -slop) }.contains(event.x, event.y)
        if (inside) onTap(if (surface === pill) tabs[tabAt(x)].id else AddId)
        pressing = null
      }
      MotionEvent.ACTION_CANCEL -> {
        surface.jelly.release()
        pressing = null
      }
    }
    overlay.requestFrame()
    overlay.invalidate()
    return true
  }

  fun tabRect(index: Int, out: RectF) {
    val left = cellLeft(index)
    val right = cellLeft(index + 1)
    out.set(pill.placement.left + left, pill.placement.top, pill.placement.left + right, pill.placement.bottom)
  }

  internal fun addRect() = add.placement

  internal fun tabCount() = tabs.size

  internal fun tabTitle(index: Int) = tabs[index].title

  internal fun tapTab(index: Int) = onTap(tabs[index].id)

  internal fun tapAdd() = onTap(AddId)

  private fun drawPill(canvas: Canvas) {
    if (tabs.isEmpty()) return
    val inset = Inset * density
    val cell = (pill.placement.width() - inset * 2f) / tabs.size
    val height = pill.placement.height()
    val radius = (Radius - Inset) * density
    fill.color = if (dark) Color.argb(46, 255, 255, 255) else Color.argb(26, 11, 13, 16)
    plate.set(slide.value, inset, slide.value + cell, height - inset)
    canvas.drawRoundRect(plate, radius, radius, fill)
    val accent = if (dark) Color.rgb(108, 200, 245) else Color.rgb(0, 137, 199)
    val muted = if (dark) Color.argb(235, 242, 243, 245) else Color.argb(225, 11, 13, 16)
    tabs.forEachIndexed { index, tab ->
      val color = if (tab.id == active) accent else muted
      val centerX = inset + cell * (index + .5f)
      drawIcon(canvas, tab.icon, centerX, height / 2f - 7f * density, 21f, color, 2f)
      label.color = color
      canvas.drawText(tab.title.uppercase(), centerX, height / 2f + 18f * density, label)
    }
  }

  private fun drawAdd(canvas: Canvas) {
    val bounds = add.placement
    drawIcon(canvas, "plus", bounds.width() / 2f, bounds.height() / 2f, 26f, Color.rgb(255, 255, 255), 2.6f)
  }

  private fun drawIcon(canvas: Canvas, name: String, centerX: Float, centerY: Float, size: Float, color: Int, weight: Float) {
    val shape = GlassIcons.path(name) ?: return
    val pixels = size * density
    val scale = pixels / 24f
    iconMatrix.setScale(scale, scale)
    iconMatrix.postTranslate(centerX - pixels / 2f, centerY - pixels / 2f)
    iconPath.reset()
    shape.transform(iconMatrix, iconPath)
    stroke.color = color
    stroke.strokeWidth = weight * density
    canvas.drawPath(iconPath, stroke)
  }

  companion object {
    const val AddId = "add"
    private const val Radius = 22f
    private const val Inset = 5f
    private const val Slop = 24f
    private val Slide = GlassSpringSpec(.72f, .34f)
    private val Fade = GlassSpringSpec(1f, .22f)
  }
}
