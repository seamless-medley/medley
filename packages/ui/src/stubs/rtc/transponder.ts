import { noop } from "lodash";
import { StubOf } from "@ui/stubs";
import type { RTCTransponder } from "@seamless-medley/remote";

class StubbingRTCTransponder {
  rtcCaps = undefined as any;

  newClientTransport = noop as any;

  initiateClientConsumer = noop as any;

  startClientConsumer = noop as any;

  stopClientConsumer = noop as any;

  closeClientTransport = noop as any;
}

export const StubRTCTransponder = StubOf<RTCTransponder>(StubbingRTCTransponder);
