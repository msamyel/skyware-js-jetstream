import type {
	At,
	ComAtprotoSyncSubscribeRepos,
	Records as _Records,
} from "@atcute/client/lexicons";
import "@atcute/bluesky/lexicons";
import { EventEmitter } from "node:events";
import { WebSocket } from "partysocket";

/** Record mappings. */
export interface Records extends _Records {}

/**
 * Options for the {@link Jetstream} class.
 */
export interface JetstreamOptions<WantedCollections extends Collection = Collection> {
	/**
	 * The full subscription endpoint to connect to.
	 * @default "wss://jetstream.atproto.tools/subscribe"
	 */
	endpoint?: string;
	/**
	 * The record collections that you want to receive updates for.
	 * Leave this empty to receive updates for all record collections.
	 */
	wantedCollections?: Array<WantedCollections>;
	/**
	 * The DIDs that you want to receive updates for.
	 * Leave this empty to receive updates for all DIDs.
	 */
	wantedDids?: Array<string>;
	/**
	 * The Unix timestamp in microseconds that you want to receive updates from.
	 */
	cursor?: string;
}

/**
 * The events that are emitted by the {@link Jetstream} class.
 * @see {@link Jetstream#on}
 */
export type JetstreamEvents<WantedCollections extends Collection = Collection> = {
	open: [];
	close: [];
	commit: [event: CommitEvent<WantedCollections>];
	account: [event: AccountEvent];
	identity: [event: IdentityEvent];
	error: [error: Error, cursor?: number];
};

/**
 * The Jetstream client.
 */
export class Jetstream<WantedCollections extends Collection = Collection>
	extends EventEmitter<JetstreamEvents<WantedCollections>>
{
	/** WebSocket connection to the server. */
	public ws?: WebSocket;

	/** The full connection URL. */
	public url: string;

	/** The current cursor. */
	public cursor?: number;

	constructor(options?: JetstreamOptions<WantedCollections>) {
		super();
		options ??= {};

		const url = new URL(options.endpoint ?? "wss://jetstream.atproto.tools/subscribe");
		options.wantedCollections?.forEach((collection) => {
			url.searchParams.append("wantedCollections", collection);
		});
		options.wantedDids?.forEach((did) => {
			url.searchParams.append("wantedDids", did);
		});
		if (options.cursor) url.searchParams.append("cursor", options.cursor);
		this.url = url.toString();
	}

	/**
	 * Opens a WebSocket connection to the server.
	 */
	start() {
		this.ws = new WebSocket(this.url.toString());

		this.ws.onopen = () => this.emit("open");
		this.ws.onclose = () => this.emit("close");
		this.ws.onerror = ({ error }) => this.emit("error", error, this.cursor);

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as
					| CommitEvent<WantedCollections>
					| AccountEvent
					| IdentityEvent;
				if (data.time_us > (this.cursor ?? 0)) this.cursor = data.time_us;
				switch (data.type) {
					case EventType.Commit:
						this.emit("commit", data);
						// @ts-expect-error – We know we can use collection name as an event.
						this.emit(data.commit.collection, data);
						break;
					case EventType.Account:
						this.emit("account", data);
						break;
					case EventType.Identity:
						this.emit("identity", data);
						break;
				}
			} catch (e) {
				this.emit("error", e instanceof Error ? e : new Error(e as never), this.cursor);
			}
		};
	}

	/**
	 * Closes the WebSocket connection.
	 */
	close() {
		this.ws?.close();
	}

	/**
	 * Listen for records created in a specific collection.
	 * @param collection The name of the collection to listen for.
	 * @param listener A callback function that receives the commit event.
	 */
	onCreate<T extends WantedCollections>(
		collection: T,
		listener: (event: CommitCreateEvent<T>) => void,
	) {
		this.on(collection, ({ commit, ...event }) => {
			if (commit.type === CommitType.Create) listener({ commit, ...event });
		});
	}

	/**
	 * Listen for records updated in a specific collection.
	 * @param collection The name of the collection to listen for.
	 * @param listener A callback function that receives the commit event.
	 */
	onUpdate<T extends WantedCollections>(
		collection: T,
		listener: (event: CommitEvent<T>) => void,
	) {
		this.on(collection, ({ commit, ...event }) => {
			if (commit.type === CommitType.Update) listener({ commit, ...event });
		});
	}

	/**
	 * Listen for records deleted in a specific collection.
	 * @param collection The name of the collection to listen for.
	 * @param listener A callback function that receives the commit event.
	 */
	onDelete<T extends WantedCollections>(
		collection: T,
		listener: (event: CommitEvent<T>) => void,
	) {
		this.on(collection, ({ commit, ...event }) => {
			if (commit.type === CommitType.Delete) listener({ commit, ...event });
		});
	}

	/** Emitted when the connection is opened. */
	override on(event: "open", listener: () => void): this;
	/** Emitted when the connection is closed. */
	override on(event: "close", listener: () => void): this;
	/** Emitted when any commit is received. */
	override on(event: "commit", listener: (event: CommitEvent<WantedCollections>) => void): this;
	/** Emitted when an account is updated. */
	override on(event: "account", listener: (event: AccountEvent) => void): this;
	/** Emitted when an identity event is received. */
	override on(event: "identity", listener: (event: IdentityEvent) => void): this;
	/**
	 * Emitted when a network error occurs.
	 * @param listener A callback function that receives the error and the last known cursor.
	 */
	override on(event: "error", listener: (error: Error, cursor?: number) => void): this;
	/**
	 * Listen for all commits related to a specific collection.
	 * @param collection The name of the collection.
	 * @param listener  A callback function that receives the commit event.
	 */
	override on<T extends WantedCollections>(
		collection: T,
		listener: (event: CommitEvent<T>) => void,
	): this;
	/**
	 * @param event The event to listen for.
	 * @param listener The callback function, called when the event is emitted.
	 */
	override on(event: string, listener: (...args: any[]) => void) {
		return super.on(event, listener as never);
	}
}

/** Resolves a lexicon name to its record type. */
export type ResolveLexicon<T extends string> = T extends keyof Records ? Records[T] : { $type: T };

/** The name of a collection. */
export type Collection = (keyof Records) | (string & {});

/**
 * The types of events that are emitted by {@link Jetstream}.
 */
export const EventType = {
	/** A new commit. */
	Commit: "com",
	/** An account's status was updated. */
	Account: "acc",
	/** An account's identity was updated. */
	Identity: "id",
} as const;
export type EventType = typeof EventType[keyof typeof EventType];

/**
 * The types of commits that can be received.
 */
export const CommitType = {
	/** A record was created. */
	Create: "c",
	/** A record was updated. */
	Update: "u",
	/** A record was deleted. */
	Delete: "d",
} as const;
export type CommitType = typeof CommitType[keyof typeof CommitType];

/**
 * The base type for events emitted by the {@link Jetstream} class.
 */
export interface EventBase {
	did: At.DID;
	time_us: number;
	type: EventType;
}

/**
 * A commit event. Represents a commit to a user repository.
 */
export interface CommitEvent<RecordType extends string> extends EventBase {
	type: typeof EventType.Commit;
	commit: Commit<RecordType>;
}

/** A commit event where a record was created. */
export interface CommitCreateEvent<RecordType extends string> extends CommitEvent<RecordType> {
	commit: CommitCreate<RecordType>;
}

/** A commit event where a record was updated. */
export interface CommitUpdateEvent<RecordType extends string> extends CommitEvent<RecordType> {
	commit: CommitUpdate<RecordType>;
}

/** A commit event where a record was deleted. */
export interface CommitDeleteEvent<RecordType extends string> extends CommitEvent<RecordType> {
	commit: CommitDelete<RecordType>;
}

/**
 * An account event. Represents a change to an account's status on a host (e.g. PDS or Relay).
 */
export interface AccountEvent extends EventBase {
	type: typeof EventType.Account;
	account: ComAtprotoSyncSubscribeRepos.Account;
}

/**
 * An identity event. Represents a change to an account's identity.
 */
export interface IdentityEvent extends EventBase {
	type: typeof EventType.Identity;
	account: ComAtprotoSyncSubscribeRepos.Identity;
}

/**
 * The base type for commit events.
 */
export interface CommitBase<RecordType extends string> {
	type: CommitType;
	rev: string;
	collection: RecordType;
	rkey: string;
}

/**
 * A commit event representing a new record.
 */
export interface CommitCreate<RecordType extends string> extends CommitBase<RecordType> {
	type: typeof CommitType.Create;
	record: ResolveLexicon<RecordType>;
	cid: At.CID;
}

/**
 * A commit event representing an update to an existing record.
 */
export interface CommitUpdate<RecordType extends string> extends CommitBase<RecordType> {
	type: typeof CommitType.Update;
	record: ResolveLexicon<RecordType>;
	cid: At.CID;
}

/**
 * A commit event representing a deletion of an existing record.
 */
export interface CommitDelete<RecordType extends string> extends CommitBase<RecordType> {
	type: typeof CommitType.Delete;
}

/**
 * A commit event.
 */
export type Commit<RecordType extends string> =
	| CommitCreate<RecordType>
	| CommitUpdate<RecordType>
	| CommitDelete<RecordType>;
