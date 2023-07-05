/// <reference types="@types/audioworklet" />

/**
 * This register a named audio processor the audioworklet
 */

import { MedleyStreamProcessor } from './stream-processor';

registerProcessor('medley-stream-processor', MedleyStreamProcessor);

