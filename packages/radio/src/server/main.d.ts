declare module 'node:events' {
  class EventEmitter {
    off: NodeJS.EventEmitter['off'];
  }
}

namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: 'development' | 'production';
  }
}
