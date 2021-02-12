import { inherits } from 'util';
import { EventEmitter } from 'events';
const medley = require('bindings')({ module_root: process.cwd(), bindings: 'medley' });

inherits(medley.Medley, EventEmitter);

export const Medley = medley.Medley;
export const Queue = medley.Queue;