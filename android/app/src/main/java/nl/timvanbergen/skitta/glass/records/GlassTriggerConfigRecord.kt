package nl.timvanbergen.skitta.glass.records

import android.graphics.Color

class GlassTriggerConfigRecord(
  val blur: Float = 1f,
  val tintColor: Color? = null,
  val tintOpacity: Float? = null,
  val saturation: Float = 1f,
  val refraction: Float = 1f,
  val rim: Float = 1f,
  val shine: Float = 1f,
  val jelly: Float = 1f,
  val morphOrigin: String = "trigger",
  val shrink: GlassShrinkRecord? = null,
  val absorb: GlassAbsorbRecord? = null,
)
