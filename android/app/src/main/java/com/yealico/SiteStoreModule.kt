package com.yealico

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 站点仓库的本地持久化。
 *
 * 只保存导入后的站点 JSON（不含 Cookie/账号）；规则原文可能较大，
 * 但 SharedPreferences 对当前 6 个站点的规模足够。
 */
class SiteStoreModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  private val preferences =
    reactContext.getSharedPreferences("yealico_site_store", Context.MODE_PRIVATE)

  override fun getName(): String = "SiteStore"

  @ReactMethod
  fun load(promise: Promise) {
    promise.resolve(preferences.getString("sites", null))
  }

  @ReactMethod
  fun save(value: String, promise: Promise) {
    preferences.edit().putString("sites", value).apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun clear(promise: Promise) {
    preferences.edit().remove("sites").apply()
    promise.resolve(true)
  }
}
