import { Exciter, IExciter } from "../../../audio/exciter";

// TODO: Forward opus packets to connectors
export class DiscordAudioPlayer extends Exciter implements IExciter {
  get isPlayable(): boolean {
    // TODO: Check connection state
    throw new Error("Method not implemented.");
  }

  prepare(): void {
    throw new Error("Method not implemented.");
  }

  dispatch(): void {
    throw new Error("Method not implemented.");
  }
}
