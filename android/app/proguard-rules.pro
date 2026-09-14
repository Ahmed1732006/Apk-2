# Add project specific ProGuard rules here.
# minifyEnabled is currently false for both build types, so this file
# isn't active yet, but is kept ready for when release minification is
# turned on.
-keepattributes *Annotation*
-keepclassmembers class * {
    @com.getcapacitor.annotation.CapacitorPlugin *;
}
