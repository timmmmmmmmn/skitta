package nl.timvanbergen.skitta.glass

import android.content.res.Resources
import android.graphics.Canvas
import android.graphics.RectF
import android.graphics.RenderNode
import android.os.Build
import android.view.ViewGroup
import androidx.annotation.RequiresApi
import nl.timvanbergen.skitta.glass.motion.GlassJelly
import nl.timvanbergen.skitta.glass.overlay.GlassMenuOverlay
import nl.timvanbergen.skitta.glass.records.GlassMenuConfigRecord
import nl.timvanbergen.skitta.glass.records.GlassMenuItemRecord
import nl.timvanbergen.skitta.glass.records.GlassTriggerConfigRecord
import nl.timvanbergen.skitta.glass.render.GlassRenderer
import nl.timvanbergen.skitta.glass.render.GlassSurfaceState
import kotlin.math.min

/** Het glazen menu: groeit uit een plek op het scherm, bijvoorbeeld een knop in de webpagina. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
class GlassMenu(root: ViewGroup) {
  private val anchor = GlassMenuAnchor(root.resources)
  private val overlay = GlassMenuOverlay(root.context, root).also { it.anchor = anchor }
  private val bar = GlassBar(overlay, root.resources).also { overlay.bar = it }

  init {
    root.addView(overlay, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  /** [from] is de plek van de knop in vensterpixels. */
  fun show(from: RectF, items: List<GlassMenuItemRecord>, dark: Boolean, onSelect: (String) -> Unit) {
    anchor.placement.set(from)
    anchor.items = items
    anchor.dark = dark
    anchor.onSelect = onSelect
    overlay.open(anchor)
  }

  /** Andere rijen of kleuren terwijl het menu open staat (een vinkje dat omgaat, ander thema). */
  fun refresh(items: List<GlassMenuItemRecord>, dark: Boolean) {
    anchor.items = items
    anchor.dark = dark
    overlay.refreshItems()
  }

  fun setBar(pill: RectF, add: RectF, tabs: List<GlassBar.Tab>, active: String, dark: Boolean, visible: Boolean, onTap: (String) -> Unit) {
    bar.update(pill, add, tabs, active, dark, visible, onTap)
  }

  fun hideBar() = bar.hide()
}

/** Een stuk glas of de plek waar een menu vandaan komt. De knop zelf kan in de pagina staan. */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal class GlassMenuAnchor(resources: Resources) {
  private val density = resources.displayMetrics.density
  private var glassRenderer: GlassRenderer? = null
  private var contentNode: RenderNode? = null

  val placement = RectF()
  val surfaceState = GlassSurfaceState()
  var items: List<GlassMenuItemRecord> = emptyList()
  var dark = false
  var onSelect: (String) -> Unit = {}
  var glass = false
  var cornerRadius: Float? = null
  var opacity = 1f
  var content: ((Canvas) -> Unit)? = null

  val followsPress = false
  val menuWidth: Float? = null
  val alignment = "auto"
  val config = GlassMenuConfigRecord()
  var triggerConfig = GlassTriggerConfigRecord()
  val jelly = GlassJelly()
  val width get() = placement.width().toInt()
  val height get() = placement.height().toInt()

  fun isDark() = dark

  fun notifySelect(item: GlassMenuItemRecord, index: Int) = onSelect(item.id)

  fun cornerRadiusPx(bounds: RectF): Float {
    val capsule = min(bounds.width(), bounds.height()) / 2f
    return min(cornerRadius?.times(density) ?: capsule, capsule)
  }

  fun applyLight(state: GlassSurfaceState, origin: RectF, opacity: Float) {
    val glow = jelly.glowValue * opacity * triggerConfig.shine
    state.pressX = origin.left + jelly.lightPositionX
    state.pressY = origin.top + jelly.lightPositionY
    state.pressRadius = LightRadius * density
    state.poolGain = LightPool * glow
    state.pressLift = LightLift * glow
    state.rimLift = LightRimLift * glow
  }

  fun recordContent(): RenderNode {
    val node = contentNode ?: RenderNode("GlassMenu.trigger").also { contentNode = it }
    node.setPosition(0, 0, width, height)
    node.setPivotX(0f)
    node.setPivotY(0f)
    node.setScaleX(1f)
    node.setScaleY(1f)
    node.setTranslationX(0f)
    node.setTranslationY(0f)
    node.setRenderEffect(null)
    val recording = node.beginRecording(width, height)
    content?.invoke(recording)
    node.endRecording()
    return node
  }

  fun renderer(pixelDensity: Float): GlassRenderer =
    glassRenderer ?: GlassRenderer(pixelDensity, pixelDensity * FieldStep).also { glassRenderer = it }

  private companion object {
    const val FieldStep = 4f
    const val LightRadius = 38f
    const val LightLift = .055f
    const val LightPool = .07f
    const val LightRimLift = .3f
  }
}
