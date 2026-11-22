# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---- GEnius (2026-11-22): R8 turned on for Play's "DEX optimization" check ----
# Our own classes: MonitorService and GeniusMonitorPlugin are referenced from the
# manifest and by name from JavaScript.
-keep class com.vonderthwood.genius.** { *; }
# @capacitor/background-runner: its native JS engine (QuickJS, JNI) calls back into
# Java by name, and RunnerWorker is enqueued by class name from MonitorService.
-keep class io.ionic.** { *; }
# Capacitor bridge: @JavascriptInterface methods are called from the WebView by name.
-keep class com.getcapacitor.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
