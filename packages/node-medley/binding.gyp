{
    "targets": [
        {
            "target_name": "medley",
            "include_dirs": [
                "<!@(node -p \"require('node-addon-api').include\")",
                "../juce/modules",
                "../engine/juce",
                "../minimp3",
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
                "../engine/src/MiniMP3AudioFormat.cpp",
                "../engine/src/MiniMP3AudioFormatReader.cpp",
                "../engine/src/LevelSmoother.cpp",
                "../engine/src/LevelTracker.cpp",
                "../engine/src/ReductionCalculator.cpp",
                "../engine/src/LookAheadReduction.cpp",
                "../engine/src/LookAheadLimiter.cpp",
                "../engine/src/PostProcessor.cpp",
                "../engine/src/Deck.cpp",
                "../engine/src/Medley.cpp",
            ],
            "cflags!": ["-fno-exceptions", '-fno-rtti'],
            "cflags_cc!": ["-fno-exceptions", '-fno-rtti'],
            'defines': [
                'UNICODE',
                '_UNICODE',
                'JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1',
                'JUCE_STRICT_REFCOUNTEDPOINTER=1',
                'JUCE_STANDALONE_APPLICATION=1',
                'JUCE_MODULE_AVAILABLE_juce_audio_basics=1',
                'JUCE_MODULE_AVAILABLE_juce_audio_devices=1',
                'JUCE_MODULE_AVAILABLE_juce_audio_formats=1',
                'JUCE_MODULE_AVAILABLE_juce_audio_processors=1',
                'JUCE_MODULE_AVAILABLE_juce_audio_utils=1',
                'JUCE_MODULE_AVAILABLE_juce_core=1',
                'JUCE_MODULE_AVAILABLE_juce_data_structures=1',
                'JUCE_MODULE_AVAILABLE_juce_dsp=1',
                'JUCE_MODULE_AVAILABLE_juce_events=1',
                'JUCE_MODULE_AVAILABLE_juce_graphics=1',
                'JUCE_MODULE_AVAILABLE_juce_gui_basics=1',
                'JUCE_MODULE_AVAILABLE_juce_gui_extra=1',
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
