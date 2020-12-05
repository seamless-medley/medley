const { Medley, Queue } = require('bindings')('medley');

const q = new Queue();
const m = new Medley(q);
m.play();
