declare module 'node:events' {
  class EventEmitter {
    off: NodeJS.EventEmitter['off'];
  }
}
