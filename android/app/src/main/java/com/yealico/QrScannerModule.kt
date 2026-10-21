package com.yealico

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * Google Code Scanner 的 RN 桥。
 *
 * 直接使用系统提供的扫码 UI：不申请 CAMERA 权限、不自己管理 CameraX 生命周期。
 * 设备缺少 Play Services 时会走 SCAN_FAILED，由 JS 侧给粘贴/URL 回退。
 */
class QrScannerModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "QrScanner"

  @ReactMethod
  fun scan(promise: Promise) {
    if (reactContext.currentActivity == null) {
      promise.reject("NO_ACTIVITY", "no foreground activity")
      return
    }

    val options = GmsBarcodeScannerOptions.Builder()
      .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
      .build()

    GmsBarcodeScanning.getClient(reactContext, options)
      .startScan()
      .addOnSuccessListener { barcode ->
        val value = barcode.rawValue
        if (value.isNullOrBlank()) {
          promise.reject("EMPTY_BARCODE", "barcode has no raw value")
        } else {
          promise.resolve(value)
        }
      }
      .addOnCanceledListener {
        promise.reject("SCAN_CANCELED", "user canceled the scan")
      }
      .addOnFailureListener { error ->
        promise.reject("SCAN_FAILED", error.message, error)
      }
  }
}
