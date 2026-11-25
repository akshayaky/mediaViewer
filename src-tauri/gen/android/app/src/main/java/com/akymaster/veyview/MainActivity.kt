package com.akymaster.veyview

import android.content.res.Configuration
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.graphics.drawable.ColorDrawable
import android.media.AudioManager
import android.os.Bundle
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.lang.ref.WeakReference

class MainActivity : TauriActivity() {
  private var videoTextureView: TextureView? = null
  private var nativeSurface: Surface? = null

  companion object {
    private var instanceRef: WeakReference<MainActivity>? = null

    init {
      try {
        System.loadLibrary("mpv")
      } catch (e: Throwable) {
        android.util.Log.w("MainActivity", "libmpv could not be preloaded via System.loadLibrary: ${e.message}")
      }
    }

    @JvmStatic
    fun setOrientation(orientation: String) {
      instanceRef?.get()?.let { activity ->
        activity.runOnUiThread {
          val windowInsetsController = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
          when (orientation) {
            "landscape" -> {
              activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
              windowInsetsController.hide(WindowInsetsCompat.Type.systemBars())
              windowInsetsController.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
            "portrait" -> {
              activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
              windowInsetsController.show(WindowInsetsCompat.Type.systemBars())
            }
            else -> {
              activity.requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
              windowInsetsController.show(WindowInsetsCompat.Type.systemBars())
            }
          }
          activity.updateVideoSurfaceInsets()
        }
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    instanceRef = WeakReference(this)
    volumeControlStream = AudioManager.STREAM_MUSIC
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    updateVideoSurfaceInsets()
  }

  fun updateVideoSurfaceInsets() {
    val textureView = videoTextureView ?: return
    val isLandscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val insets = ViewCompat.getRootWindowInsets(textureView)
    val statusBarInset = if (isLandscape) 0 else (insets?.getInsets(WindowInsetsCompat.Type.statusBars())?.top ?: 0)
    val lp = textureView.layoutParams as? ViewGroup.MarginLayoutParams ?: ViewGroup.MarginLayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    )
    if (lp.topMargin != statusBarInset) {
      lp.topMargin = statusBarInset
      textureView.layoutParams = lp
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.setBackgroundColor(Color.TRANSPARENT)
    window.setBackgroundDrawable(ColorDrawable(Color.BLACK))

    webView.post {
      setupVideoSurface(webView)
    }
  }

  private fun setupVideoSurface(webView: WebView) {
    val parent = (webView.parent as? ViewGroup) ?: findViewById<ViewGroup>(android.R.id.content) ?: return
    if (videoTextureView != null && videoTextureView?.parent != null) {
      return
    }

    val textureView = TextureView(this)
    textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
        android.util.Log.i("MainActivity", "Native video SurfaceTexture available: ${width}x${height}")
        val surface = Surface(st)
        nativeSurface = surface
        onNativeSurfaceCreated(surface)
        onNativeSurfaceChanged(surface, width, height)
      }

      override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) {
        android.util.Log.i("MainActivity", "Native video SurfaceTexture size changed: ${width}x${height}")
        nativeSurface?.let { onNativeSurfaceChanged(it, width, height) }
      }

      override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        android.util.Log.i("MainActivity", "Native video SurfaceTexture destroyed")
        nativeSurface?.let { onNativeSurfaceDestroyed(it) }
        nativeSurface?.release()
        nativeSurface = null
        return true
      }

      override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
    }

    ViewCompat.setOnApplyWindowInsetsListener(textureView) { _, insets ->
      updateVideoSurfaceInsets()
      insets
    }

    val lp = ViewGroup.MarginLayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    )
    parent.addView(textureView, 0, lp)
    videoTextureView = textureView
    updateVideoSurfaceInsets()
  }

  private external fun onNativeSurfaceCreated(surface: Surface)
  private external fun onNativeSurfaceChanged(surface: Surface, width: Int, height: Int)
  private external fun onNativeSurfaceDestroyed(surface: Surface)
}
