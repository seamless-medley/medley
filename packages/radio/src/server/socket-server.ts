import { SocketServer, SocketServerController } from "../socket";
import { RemoteTypes, RemoteCounter } from "../socket/remote";
import { MixinEventEmitterOf, Exposable } from "../socket/types";

export class Server extends SocketServerController<RemoteTypes> {
  constructor(io: SocketServer) {
    super(io);

    const test = new ExposedCounter();

    setInterval(() => test.inc(), 1000);

    this.register('root', 'test', test);
    this.register('root', 'test', test);
  }
}

class ExposedCounter extends MixinEventEmitterOf<RemoteCounter>() implements Exposable<RemoteCounter> {
  _count = 0;

  get count() {
    return this._count;
  }

  set count(v) {
    this._count = v;
  }

  inc(amount: number = 1) {
    this.count += amount;
    this.emit('increased', this.count);
  }

  reset(to: number) {
    return this.count = to;
  }

  // test = () => {
  //   return this._count;
  // }
}


  /**
   * List of Stations
   *  |- Station
   *    |- Intro
   *    |- Sweeper Rule[]
   *    |- Request Sweeper[]
   *    |- Music Collection
   *    |- Crate/Sequence
   *
   * List of Automaton
   *  |- Automaton
   *    |- Station Registry
   */

