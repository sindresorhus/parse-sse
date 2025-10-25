/**
A parsed Server-Sent Event.
*/
export type ServerSentEvent = {
	/**
	The event type.

	@default 'message'
	*/
	type: string;

	/**
	The event data.

	Multiple `data:` fields are joined with newlines.
	*/
	data: string;

	/**
	The last event ID in the stream.

	This is connection-scoped state that persists across events. When an event includes an `id:` field, this value is updated and persists for all subsequent events until changed again.

	Always present as a string (empty string if no ID has been set). Matches browser `MessageEvent.lastEventId` behavior.

	Used for reconnection with `Last-Event-ID` header.
	*/
	lastEventId: string;

	/**
	The retry interval in milliseconds, if specified.

	Indicates how long to wait before reconnecting.
	*/
	retry: number | undefined;
};

/**
TransformStream that parses Server-Sent Events.

Use this for advanced stream composition or when you have a text stream that's already decoded.

__Important:__ This expects string chunks as input. If you have a byte stream, pipe it through `TextDecoderStream` first.

@example
```
import {ServerSentEventTransformStream} from 'parse-sse';

// Custom pipeline
myTextStream
	.pipeThrough(new ServerSentEventTransformStream())
	.pipeTo(myWritableStream);
```

@example
```
import {ServerSentEventTransformStream} from 'parse-sse';

// With custom decoder
response.body
	.pipeThrough(new MyCustomDecoderStream())
	.pipeThrough(new ServerSentEventTransformStream());
```

@example
```
import {ServerSentEventTransformStream} from 'parse-sse';

// Filter events in a pipeline
fetch(url)
	.then(r => r.body)
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(new ServerSentEventTransformStream())
	.pipeThrough(new TransformStream({
		transform(event, controller) {
			if (event.type === 'update') {
				controller.enqueue(event);
			}
		}
	}));
```
*/
export class ServerSentEventTransformStream extends TransformStream<string, ServerSentEvent> {
	constructor();
}

/**
Parse a Server-Sent Events (SSE) stream from a Response object.

Returns a ReadableStream that yields parsed events as they arrive. The stream can be consumed using async iteration (`for await...of`) or stream methods like `.pipeTo()`, `.pipeThrough()`, and `.tee()`.

@param response - The Response object with a `text/event-stream` body.
@returns A ReadableStream of parsed SSE events.

@example
```
import {parseServerSentEvents} from 'parse-sse';

const response = await fetch('https://api.example.com/events');

for await (const event of parseServerSentEvents(response)) {
	if (event.type === 'update') {
		console.log('Update:', event.data);
	}
}
```

@example
```
import {parseServerSentEvents} from 'parse-sse';
import ky from 'ky';

const response = await ky.get('https://api.example.com/events');

for await (const event of parseServerSentEvents(response)) {
	const data = JSON.parse(event.data);
	console.log(data);
}
```

@example
```
import {parseServerSentEvents} from 'parse-sse';

// OpenAI streaming
const response = await fetch('https://api.openai.com/v1/chat/completions', {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'Authorization': `Bearer ${apiKey}`,
	},
	body: JSON.stringify({
		model: 'gpt-4',
		messages: [{role: 'user', content: 'Hello!'}],
		stream: true,
	}),
});

for await (const event of parseServerSentEvents(response)) {
	if (event.data === '[DONE]') {
		break;
	}

	const data = JSON.parse(event.data);
	console.log(data.choices[0]?.delta?.content);
}
```

@example
```
import {parseServerSentEvents} from 'parse-sse';

// Advanced: using stream methods
const response = await fetch('https://api.example.com/events');
const eventStream = parseServerSentEvents(response);

// Tee the stream to consume it twice
const [stream1, stream2] = eventStream.tee();

// Process both streams in parallel
await Promise.all([
	(async () => {
		for await (const event of stream1) {
			console.log('Stream 1:', event.data);
		}
	})(),
	(async () => {
		for await (const event of stream2) {
			console.log('Stream 2:', event.data);
		}
	})(),
]);
```
*/
export function parseServerSentEvents(
	response: Response,
): ReadableStream<ServerSentEvent>;
