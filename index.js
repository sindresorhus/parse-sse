/**
TransformStream that parses Server-Sent Events.

Use this for advanced stream composition or when you have a text stream that's already decoded.

@example
```
import {ServerSentEventTransformStream} from 'parse-sse';

// Custom pipeline
myTextStream
	.pipeThrough(new ServerSentEventTransformStream())
	.pipeTo(myWritableStream);

// With custom decoder
response.body
	.pipeThrough(new MyCustomDecoderStream())
	.pipeThrough(new ServerSentEventTransformStream());
```
*/
export class ServerSentEventTransformStream extends TransformStream {
	constructor() {
		let buffer = '';
		let isFirstChunk = true;
		let event = createEvent();
		let lastEventId = ''; // Stream-level state: persists across events

		super({
			transform(chunk, controller) {
				// ServerSentEventTransformStream expects string chunks (already decoded)
				// Use TextDecoderStream before this if you have bytes
				if (typeof chunk !== 'string') {
					throw new TypeError('ServerSentEventTransformStream expects string chunks. Pipe through TextDecoderStream first for byte streams.');
				}

				let text = chunk;

				// Strip BOM from first chunk (spec requires UTF-8 encoding)
				if (isFirstChunk) {
					text = text.replace(/^\uFEFF/, '');
					isFirstChunk = false;
				}

				buffer += text;

				// Process complete lines
				const lines = buffer.split(/\r\n|\r|\n/);

				// Keep incomplete line in buffer
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					// Empty line dispatches the event
					if (line === '') {
						dispatchEvent(event, controller, lastEventId);
						event = createEvent();
						continue;
					}

					// Ignore comments
					if (line.startsWith(':')) {
						continue;
					}

					// Parse and apply field to event
					processField(line, event, value => {
						lastEventId = value;
					});
				}
			},

			flush(controller) {
				// Process any remaining buffer (unless it's a comment)
				if (buffer && !buffer.startsWith(':')) {
					processField(buffer, event, value => {
						lastEventId = value;
					});
				}

				// Dispatch final event if it has data
				dispatchEvent(event, controller, lastEventId);
			},
		});
	}
}

function createEvent() {
	return {
		type: '',
		data: '',
		retry: undefined,
	};
}

function dispatchEvent(event, controller, lastEventId) {
	let {data} = event;

	// Remove trailing newline from data (added after each data field)
	if (data.endsWith('\n')) {
		data = data.slice(0, -1);
	}

	// Only dispatch if data is non-empty (per spec)
	if (!data) {
		return;
	}

	controller.enqueue({
		type: event.type || 'message', // Default to 'message' if empty (per spec)
		data,
		lastEventId, // Always present, matches browser MessageEvent.lastEventId
		retry: event.retry,
	});
}

function processField(line, event, setLastEventId) {
	const colonIndex = line.indexOf(':');

	const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
	let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);

	// Remove single leading space from value (spec requirement)
	if (value.startsWith(' ')) {
		value = value.slice(1);
	}

	switch (field) {
		case 'event': {
			event.type = value;
			break;
		}

		case 'data': {
			// Append data with newline (SSE spec allows multiple data fields)
			event.data += value + '\n';
			break;
		}

		case 'id': {
			// Spec: Ignore field if value contains NULL character
			// Otherwise update the stream-level last event ID (persists across events)
			if (!value.includes('\0')) {
				setLastEventId(value);
			}

			break;
		}

		case 'retry': {
			// Spec: Only accept if value consists of only ASCII digits
			if (/^\d+$/.test(value)) {
				event.retry = Number.parseInt(value, 10);
			}

			break;
		}

		default: {
			// Unknown fields are ignored per spec
			// No action needed
			break;
		}
	}
}

/**
Parse a Server-Sent Events (SSE) stream from a Response object.

@param {Response} response - The Response object with a `text/event-stream` body.
@returns {ReadableStream<ServerSentEvent>} A stream of parsed SSE events.

@example
```
import {parseServerSentEvents} from 'parse-sse';

const response = await fetch('https://api.example.com/events');

for await (const event of parseServerSentEvents(response)) {
	console.log(event.type, event.data);
}
```
*/
export function parseServerSentEvents(response) {
	if (!response) {
		throw new TypeError('Expected a Response object');
	}

	if (!response.body) {
		throw new TypeError('Expected response to have a body');
	}

	return response.body
		.pipeThrough(new TextDecoderStream())
		.pipeThrough(new ServerSentEventTransformStream());
}
