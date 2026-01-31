{
  "targets": [
    {
      "target_name": "darktable_native",
      "sources": [
        "src/darktable_native.cc",
        "src/iop/exposure.cc",
        "src/iop/colorbalance.cc",
        "src/iop/tonecurve.cc",
        "src/iop/sharpen.cc",
        "src/iop/denoise.cc",
        "src/iop/hazeremoval.cc",
        "src/iop/highlights_shadows.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src",
        "src/iop"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17", "-O3", "-march=native"],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "CLANG_CXX_LIBRARY": "libc++",
        "MACOSX_DEPLOYMENT_TARGET": "10.15",
        "OTHER_CFLAGS": ["-O3"]
      },
      "conditions": [
        ["OS=='mac'", {
          "libraries": [
            "-framework Accelerate"
          ]
        }]
      ]
    }
  ]
}
