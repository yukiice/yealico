package com.yealico

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.widget.FrameLayout
import java.net.HttpURLConnection
import java.net.URL
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import org.json.JSONObject
import org.json.JSONTokener

/**
 * 用 Android WebView 渲染需要 JS 的详情/图库页，返回 outerHTML。
 *
 * 这是有意的“隐藏浏览器”而不是网络抓取：页面在真实 WebView 里执行，
 * 等待规则指定的 DOM 标记后把 DOM 交给现有规则引擎。一次只渲染一个页面。
 */
class WebViewRendererModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val handler = Handler(Looper.getMainLooper())
  private var active = false
  private var activeWebView: WebView? = null
  private val browserUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/126.0.0.0 Safari/537.36"

  override fun getName(): String = "WebViewRenderer"

  @ReactMethod
  fun render(
    url: String,
    waitForSelector: String?,
    timeoutMs: Double,
    promise: Promise,
  ) {
    start(promise, waitForSelector, timeoutMs) { webView ->
      webView.loadUrl(
        url,
        mapOf("Accept-Language" to "zh-CN,zh;q=0.9,en;q=0.8"),
      )
    }
  }

  @ReactMethod
  fun renderHtml(
    html: String,
    baseUrl: String,
    waitForSelector: String?,
    timeoutMs: Double,
    promise: Promise,
  ) {
    start(promise, waitForSelector, timeoutMs) { webView ->
      webView.loadDataWithBaseURL(baseUrl, html, "text/html", "UTF-8", null)
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun start(
    promise: Promise,
    waitForSelector: String?,
    timeoutMs: Double,
    load: (WebView) -> Unit,
  ) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "No current Android Activity for WebView")
      return
    }

    UiThreadUtil.runOnUiThread {
      if (active) {
        promise.reject("busy", "WebViewRenderer is already rendering a page")
        return@runOnUiThread
      }
      active = true

      val container = FrameLayout(activity).apply {
        alpha = 0f
      }
      var pollingStarted = false
      val webView = WebView(activity).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.loadsImagesAutomatically = false
        settings.blockNetworkImage = true
        settings.userAgentString = browserUserAgent
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
        webViewClient = object : WebViewClient() {
          override fun shouldInterceptRequest(
            view: WebView,
            request: WebResourceRequest,
          ): WebResourceResponse? {
            // mangacopy 的章节接口按 Client Hints 返回不同数据：桌面 CH 是完整
            // 加密章节串，移动 CH 是受限数据。Android WebView 无法修改 UA-CH，
            // 所以对这个接口用桌面请求头代发，再把响应交给页面 JS 解密。
            val target = request.url.toString()
            if (!target.contains("/comicdetail/") || !target.contains("/chapters")) {
              return null
            }
            return try {
              val connection = URL(target).openConnection() as HttpURLConnection
              connection.connectTimeout = 15_000
              connection.readTimeout = 15_000
              connection.instanceFollowRedirects = true
              connection.setRequestProperty("User-Agent", browserUserAgent)
              connection.setRequestProperty("Accept", "application/json, text/plain, */*")
              connection.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
              // WebResourceResponse 不会解压 gzip，显式要未压缩响应。
              connection.setRequestProperty("Accept-Encoding", "identity")
              connection.setRequestProperty("Sec-CH-UA-Mobile", "?0")
              connection.setRequestProperty("Sec-CH-UA-Platform", "\"macOS\"")
              connection.setRequestProperty(
                "Sec-CH-UA",
                "\"Chromium\";v=\"126\", \"Google Chrome\";v=\"126\", \"Not-A.Brand\";v=\"99\"",
              )
              val referer = request.requestHeaders["Referer"]
                ?: request.requestHeaders["referer"]
              if (!referer.isNullOrEmpty()) {
                connection.setRequestProperty("Referer", referer)
              }
              val cookie = CookieManager.getInstance().getCookie(target)
              if (!cookie.isNullOrEmpty()) {
                connection.setRequestProperty("Cookie", cookie)
              }
              connection.connect()
              if (connection.responseCode !in 200..299) {
                connection.disconnect()
                return null
              }
              val mime = connection.contentType?.substringBefore(';') ?: "application/json"
              WebResourceResponse(mime, "utf-8", connection.inputStream)
            } catch (error: Exception) {
              null
            }
          }

          override fun onPageFinished(view: WebView, finishedUrl: String) {
            if (pollingStarted) {
              return
            }
            pollingStarted = true
            pollForDocument(
              view,
              waitForSelector,
              timeoutMs.toLong().coerceAtLeast(1_000L),
              promise,
              container,
              0,
            )
          }

          override fun onReceivedHttpError(
            view: WebView,
            request: android.webkit.WebResourceRequest,
            errorResponse: android.webkit.WebResourceResponse,
          ) {
            if (request.isForMainFrame) {
              fail(
                promise,
                container,
                "http_error",
                "HTTP ${errorResponse.statusCode} for ${request.url}",
              )
            }
          }
        }
      }
      activeWebView = webView
      container.addView(
        webView,
        FrameLayout.LayoutParams(
          ViewGroup.LayoutParams.MATCH_PARENT,
          ViewGroup.LayoutParams.MATCH_PARENT,
        ),
      )
      activity.addContentView(
        container,
        ViewGroup.LayoutParams(1, 1),
      )
      load(webView)
    }
  }

  private fun pollForDocument(
    webView: WebView,
    waitForSelector: String?,
    timeoutMs: Long,
    promise: Promise,
    container: FrameLayout,
    attempt: Int,
  ) {
    if (!active) {
      return
    }
    if (attempt * 100L > timeoutMs) {
      val infoScript =
        "document.title + ' | ' + location.href + ' | manga=' + " +
          "(document.querySelector('#manga') ? 'yes' : 'no') + ' | imgs=' + " +
          "document.querySelectorAll('img').length + ' | ' + " +
          "'wait=' + " + quoteJs(waitForSelector ?: "") + " + ' | ' + " +
          "Array.prototype.slice.call(document.images, 0, 4).map(function (img) {" +
          "return (img.src || '') + '|' + (img.className || '') + '|' + " +
          "(img.parentElement ? (img.parentElement.id || '') : '') + '|' + " +
          "(img.parentElement ? (img.parentElement.className || '') : '');" +
          "}).join(' ; ')"
      webView.evaluateJavascript(infoScript) { raw ->
        val info = decodeJavascriptString(raw)
        webView.evaluateJavascript(
          "(function(){try{return document.documentElement.outerHTML;}catch(e){return '';}})()",
        ) { htmlRaw ->
          val debugHtml = decodeJavascriptString(htmlRaw)
          val debuggable =
            (reactApplicationContext.applicationInfo.flags and
              ApplicationInfo.FLAG_DEBUGGABLE) != 0
          if (debuggable) {
            try {
              java.io.File(
                reactApplicationContext.filesDir,
                "yelico-last-render.html",
              ).writeText(debugHtml)
            } catch (error: Exception) {
              // 调试落盘失败不影响主流程。
            }
          }
          fail(
            promise,
            container,
            "timeout",
            "WebView render timed out after ${timeoutMs}ms: $info",
          )
        }
      }
      return
    }

    val script = if (waitForSelector.isNullOrBlank()) {
      "document.documentElement ? document.documentElement.outerHTML : null"
    } else {
      "(function(){return document.querySelector(${quoteJs(waitForSelector)}) ? document.documentElement.outerHTML : null;})()"
    }
    webView.evaluateJavascript(script) { raw ->
      val html = decodeJavascriptString(raw)
      if (html.isNotEmpty()) {
        succeed(promise, container, webView.url ?: "", html)
      } else {
        handler.postDelayed(
          {
            pollForDocument(
              webView,
              waitForSelector,
              timeoutMs,
              promise,
              container,
              attempt + 1,
            )
          },
          100L,
        )
      }
    }
  }

  private fun succeed(
    promise: Promise,
    container: FrameLayout,
    url: String,
    html: String,
  ) {
    cleanup(container)
    promise.resolve(
      com.facebook.react.bridge.Arguments.createMap().apply {
        putString("url", url)
        putString("body", html)
      },
    )
  }

  private fun fail(
    promise: Promise,
    container: FrameLayout,
    code: String,
    message: String,
  ) {
    cleanup(container)
    promise.reject(code, message)
  }

  private fun cleanup(container: FrameLayout) {
    if (!active) {
      return
    }
    active = false
    handler.removeCallbacksAndMessages(null)
    activeWebView?.apply {
      stopLoading()
      webViewClient = WebViewClient()
      destroy()
    }
    activeWebView = null
    (container.parent as? ViewGroup)?.removeView(container)
  }

  private fun decodeJavascriptString(raw: String?): String {
    if (raw == null || raw == "null" || raw == "\"\"") {
      return ""
    }
    return try {
      when (val value = JSONTokener(raw).nextValue()) {
        is String -> value
        else -> ""
      }
    } catch (_: Exception) {
      ""
    }
  }

  private fun quoteJs(value: String): String {
    return JSONObject.quote(value)
  }
}
