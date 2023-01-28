import { concatUint8Array } from "@seamless-medley/utils";
import { random } from "lodash";
import { OggPage } from "../../containers/ogg/page";
import { OpusHead, OpusTags } from "./frame";

/** @deprecated */
export function makeOpusOGGHeaders(head: OpusHead, vendorString: string, serial: number = random(2**32)) {
  return concatUint8Array(
    new OggPage({
      type: { first: true },
      serial,
      sequence: 0,
      granulePosition: 0n,
      data: head.toUint8Array()
    }).toUint8Array(),

    new OggPage({
      serial,
      sequence: 1,
      granulePosition: 0n,
      data: new OpusTags({ vendor: vendorString }).toUint8Array()
    }).toUint8Array()
  )
}

/** @deprecated */
export class OpusOggPageMaker {
  #rawHeaders: Uint8Array;
  #serial: number;

  constructor(head: OpusHead, vendorString: string, serial: number = random(2**32)) {
    this.#serial = serial;
    this.#rawHeaders = makeOpusOGGHeaders(head, vendorString, serial)
  }

  pack(...packets: Uint8Array[]) {
    const pages = packets.map((data, index) => {
      return new OggPage({
        serial: this.#serial,
        sequence: index + 2,
        granulePosition: 0n,
        data
      }).toUint8Array()
    });

    return concatUint8Array(this.#rawHeaders, ...pages);
  }
}
