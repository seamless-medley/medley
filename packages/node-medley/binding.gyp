{
    "targets": [
        {
            "target_name": "medley",
            "include_dirs": [
                "<!@(node -p \"require('node-addon-api').include\")",
                "../juce/modules",
                "../engine/juce",
                "../engine/src"
            ],
            "sources": [
                "src/test.cpp",
                "../engine/juce/include_juce_audio_basics.cpp",
                "../engine/juce/include_juce_audio_devices.cpp",
                "../engine/juce/include_juce_audio_formats.cpp",
                "../engine/juce/include_juce_audio_processors.cpp",
                "../engine/juce/include_juce_audio_utils.cpp",
                "../engine/juce/include_juce_core.cpp",
                "../engine/juce/include_juce_data_structures.cpp",
                "../engine/juce/include_juce_dsp.cpp",
                "../engine/juce/include_juce_events.cpp",
                "../engine/juce/include_juce_graphics.cpp",
                "../engine/juce/include_juce_gui_basics.cpp",
                "../engine/juce/include_juce_gui_extra.cpp",
            ],
            "cflags!": ["-fno-exceptions", '-fno-rtti'],
            "cflags_cc!": ["-fno-exceptions", '-fno-rtti'],
            'defines': [
                'UNICODE',
                '_UNICODE',
                'NAPI_DISABLE_CPP_EXCEPTIONS',
                'JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1',
                'JUCE_STRICT_REFCOUNTEDPOINTER=1',
                'JUCE_STANDALONE_APPLICATION=1 ',
            ],
            'conditions': [
                [
                    'OS=="win"',
                    {
                        'cflags': [
                            '/GR',
                        ],
                        'configurations': {
                            'Debug': {
                                'msvs_settings': {
                                    'VCCLCompilerTool': {
                                        'RuntimeTypeInfo': 'true',
                                        'ExceptionHandling': 'true',
                                        'AdditionalOptions': ['/GR', '/EHsc', '/MTd', '/source-charset:utf-8'],
                                    }
                                }
                            },
                            'Release': {
                                'msvs_settings': {
                                    'VCCLCompilerTool': {
                                        'RuntimeTypeInfo': 'true',
                                        'ExceptionHandling': 'true',
                                        'AdditionalOptions': ['/GR', '/EHsc', '/MT', '/source-charset:utf-8'],
                                    }
                                }
                            }
                        }
                    }
                ]
            ]
        }
    ]
}
