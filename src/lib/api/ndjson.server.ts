/**
 * The NDJSON upload scaffolding every streaming upload endpoint shares.
 *
 * An upload answers with an NDJSON event stream instead of a JSON body: one
 * event object per line — `uploading` while the file travels to the storage
 * provider, then `done` or `error`. The stream, the event encoding and the
 * failure path are the same everywhere, so they live here; an endpoint only
 * states what is specific to it — which events are valid, what the failure
 * message says and how the upload itself is performed.
 *
 * Adding an upload endpoint is therefore a matter of calling
 * {@link createNdjsonUploadStream} with those three answers and returning the
 * stream it hands back.
 *
 * Server-only: it serves the upload endpoints, which run where the storage
 * providers and the database are reachable.
 */

/** Writes one event into the stream; the endpoint decides what events mean. */
export type NdjsonEventEmitter = (event: unknown) => void;

/** The part of the event schema the stream needs: it validates one event. */
type NdjsonEventSchema = { parse: (event: unknown) => unknown };

export type NdjsonUploadStreamOptions = {
  /** The schema every emitted event has to satisfy. */
  eventSchema: NdjsonEventSchema;
  /** The message the `error` event carries when the upload fails. */
  errorMessage: string;
  /** Labels the failure in the server log. */
  errorLabel: string;
  /** Performs the upload and emits the `done` event. */
  upload: (emit: NdjsonEventEmitter) => Promise<void>;
  /** Response headers the NDJSON content type is written into. */
  resHeaders?: Headers | undefined;
};

/**
 * Stream an upload as NDJSON events.
 *
 * The upload runs in the background so the response can start streaming right
 * away; the client follows it through the events. When it fails, the failure is
 * logged and reported as an `error` event instead of a broken response — the
 * status was already sent by then, so it cannot be changed any more.
 */
export const createNdjsonUploadStream = ({
  eventSchema,
  errorMessage,
  errorLabel,
  upload,
  resHeaders
}: NdjsonUploadStreamOptions): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    }
  });

  const emit: NdjsonEventEmitter = (event) => {
    const payload = eventSchema.parse(event);
    streamController.enqueue(encoder.encode(JSON.stringify(payload) + '\n'));
  };

  (async () => {
    try {
      await upload(emit);
      streamController.close();
    } catch (err) {
      console.error(errorLabel, err);
      try {
        emit({ phase: 'error', message: errorMessage });
        streamController.close();
      } catch {
        // controller may already be closed
      }
    }
  })();

  resHeaders?.set('Content-Type', 'application/x-ndjson');
  resHeaders?.set('X-Accel-Buffering', 'no');
  resHeaders?.set('Cache-Control', 'no-cache');

  return stream;
};
