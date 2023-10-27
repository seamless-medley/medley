import { noop } from "lodash";
import { type RTCTransponder } from "../../../remotes/rtc/transponder";
import { StubOf } from "../../../socket/stub";

class StubbingRTCTransponder {
  caps = undefined as any;

  newClientTransport = noop as any;

  initiateClientConsumer = noop as any;

  startClientConsumer = noop as any;

  closeClientTransport = noop as any;
}

export const StubRTCTransponder = StubOf<RTCTransponder>(StubbingRTCTransponder);
