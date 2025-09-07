import { TypedEmitter } from "tiny-typed-emitter";
import { DAVESession as DaveySession } from '@snazzah/davey';
import { DavePrepareEpochData, DavePrepareTransitionData, SILENCE_FRAME } from "./payload";

const TRANSITION_EXPIRY = 10;

const TRANSITION_EXPIRY_PENDING_DOWNGRADE = 24;

export type TransitionResult = {
	success: boolean;
	transitionId: number;
}

export interface DaveSessionEvents {
  keyPackage(message: Buffer): void;
  invalidateTransition(transitionId: number): void
}

export class DaveSession extends TypedEmitter<DaveSessionEvents> {
  #protocolVersion: number;

  #userId: string;

  #channelId: string;

  #session?: DaveySession;

  #pendingTransition?: DavePrepareTransitionData;

  #downgraded = false;

  reinitializing = false;

  lastTransitionId?: number;

  constructor(protocolVersion: number, userId: string, channelId: string,) {
    super();

    this.#protocolVersion = protocolVersion;
    this.#userId = userId;
    this.#channelId = channelId;
  }

	public destroy() {
		try {
			this.#session?.reset();
		} catch {

    }
	}

  reinit() {
    if (this.#protocolVersion > 0) {
      if (this.#session) {
        this.#session.reinit(this.#protocolVersion, this.#userId, this.#channelId);
      } else {
        this.#session = new DaveySession(this.#protocolVersion, this.#userId, this.#channelId);
      }

      this.emit('keyPackage', this.#session.getSerializedKeyPackage());

      return;
    }

    if (this.#session) {
      this.#session.reset();
      this.#session.setPassthroughMode(true, TRANSITION_EXPIRY);
    }
  }

	setExternalSender(externalSender: Buffer) {
		if (!this.#session) {
      throw new Error('No session available');
    }

		this.#session.setExternalSender(externalSender);
	}

  prepareEpoch(data: DavePrepareEpochData) {
    if (data.epoch === 1) {
      // a new MLS group is being created

      this.#protocolVersion = data.protocol_version;
      this.reinit();
    }
  }

  prepareTransition(data: DavePrepareTransitionData) {
    this.#pendingTransition = data;

    if (data.transition_id === 0) {
			this.executeTransition(data.transition_id);
		} else {
			if (data.protocol_version === 0) {
        this.#session?.setPassthroughMode(true, TRANSITION_EXPIRY_PENDING_DOWNGRADE)
      }

			return true;
		}

		return false;
  }

  executeTransition(transitionId: number) {
    if (!this.#pendingTransition) {
      return;
    }

    let transitioned = false;

    if (transitionId === this.#pendingTransition.transition_id) {
      const oldVersion = this.#protocolVersion;
      this.#protocolVersion = this.#pendingTransition.protocol_version;

      if (oldVersion !== this.#protocolVersion && this.#protocolVersion === 0) {
        this.#downgraded = true;
      } else if (transitionId > 0 && this.#downgraded) {
        this.#downgraded = false;
        this.#session?.setPassthroughMode(true, TRANSITION_EXPIRY);
      }

      transitioned = true;
      this.reinitializing = false;
			this.lastTransitionId = transitionId;
    }

		this.#pendingTransition = undefined;
		return transitioned;
  }

  encrypt(packet: Buffer) {
    if (this.#protocolVersion === 0 || !this.#session?.ready || packet.equals(SILENCE_FRAME)) {
      return packet;
    }

    return this.#session.encryptOpus(packet);
  }

	recoverFromInvalidTransition(transitionId: number) {
		if (this.reinitializing) {
      return;
    }

		this.reinitializing = true;
    this.emit('invalidateTransition', transitionId);
		this.reinit();
	}

	processProposals(payload: Buffer, connectedClients: Set<string>): Buffer | undefined {
		if (!this.#session) {
      throw new Error('No session available');
    }

		const optype = payload.readUInt8(0) as 0 | 1;
		const { commit, welcome } = this.#session.processProposals(
			optype,
			payload.subarray(1),
			Array.from(connectedClients),
		);

		if (!commit) {
      return;
    }

		return welcome ? Buffer.concat([commit, welcome]) : commit;
	}

	processCommit(payload: Buffer): TransitionResult {
		if (!this.#session) {
      throw new Error('No session available');
    }

		const transitionId = payload.readUInt16BE(0);
		try {
			this.#session.processCommit(payload.subarray(2));
			if (transitionId === 0) {
				this.reinitializing = false;
				this.lastTransitionId = transitionId;
			} else {
				this.#pendingTransition = { transition_id: transitionId, protocol_version: this.#protocolVersion };
			}

			return { transitionId, success: true };
		} catch (error) {
			this.recoverFromInvalidTransition(transitionId);
			return { transitionId, success: false };
		}
	}

	processWelcome(payload: Buffer): TransitionResult {
		if (!this.#session) {
      throw new Error('No session available');
    }

		const transitionId = payload.readUInt16BE(0);
		try {
			this.#session.processWelcome(payload.subarray(2));
			if (transitionId === 0) {
				this.reinitializing = false;
				this.lastTransitionId = transitionId;
			} else {
				this.#pendingTransition = { transition_id: transitionId, protocol_version: this.#protocolVersion };
			}

			return { transitionId, success: true };
		} catch (error) {
			this.recoverFromInvalidTransition(transitionId);
			return { transitionId, success: false };
		}
	}
}
