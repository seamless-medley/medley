declare module 'node:events' {
  class EventEmitter {
    off: NodeJS.EventEmitter['off'];
  }
}

namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: 'development' | 'production';

    MEDLEY_IN_DOCKER?: string;

    MEDLEY_DEFAULT_RTC_IP?: string;

    MEDLEY_DEFAULT_RTC_PORT?: string;
  }
}
