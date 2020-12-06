module.exports =  require('bindings')('medley');

export declare class Queue {
  add(path: string): void;
}

export declare class Medley {
  constructor(queue: Queue);

  play(): void;
  stop(): void;
}