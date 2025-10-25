# parse-sse

> Parse [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) (SSE) from a [Response](https://developer.mozilla.org/docs/Web/API/Response)

A lightweight, spec-compliant parser for Server-Sent Events that works with the native Fetch API. Returns a standard ReadableStream for maximum composability.

Perfect for consuming streaming APIs from OpenAI, Anthropic, and other services.

## Install

```sh
npm install parse-sse
```

## Usage

```js
import {parseServerSentEvents} from 'parse-sse';

const response = await fetch('https://api.example.com/events');

for await (const event of parseServerSentEvents(response)) {
	console.log(event.type);        // Event type (default: 'message')
	console.log(event.data);        // Event data
	console.log(event.lastEventId); // Last event ID (always present as string)
	console.log(event.retry);       // Retry interval in ms (if specified)
}
```

### With [Ky](https://github.com/sindresorhus/ky)

```js
import {parseServerSentEvents} from 'parse-sse';
import ky from 'ky';

const response = await ky('https://api.example.com/events');

for await (const event of parseServerSentEvents(response)) {
	const data = JSON.parse(event.data);
	console.log(data);
}
```

### OpenAI Streaming

```js
import {parseServerSentEvents} from 'parse-sse';

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

### Custom Event Types

```js
import {parseServerSentEvents} from 'parse-sse';

const response = await fetch('https://api.example.com/events');

for await (const event of parseServerSentEvents(response)) {
	switch (event.type) {
		case 'update':
			console.log('Update:', event.data);
			break;
		case 'complete':
			console.log('Complete:', event.data);
			break;
		case 'error':
			console.error('Error:', event.data);
			break;
		default:
			console.log('Message:', event.data);
	}
}
```

### Advanced: Stream Composability

Since `parseServerSentEvents()` returns a standard ReadableStream, you can use all stream methods:

```js
import {parseServerSentEvents} from 'parse-sse';

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

### Advanced: Using ServerSentEventTransformStream

For advanced use cases, you can use `ServerSentEventTransformStream` directly for custom stream pipelines:

```js
import {ServerSentEventTransformStream} from 'parse-sse';

// Custom pipeline
myTextStream
	.pipeThrough(new ServerSentEventTransformStream())
	.pipeTo(myWritableStream);
```

```js
import {ServerSentEventTransformStream} from 'parse-sse';

// With custom decoder
response.body
	.pipeThrough(new MyCustomDecoderStream())
	.pipeThrough(new ServerSentEventTransformStream());
```

```js
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

## API

### parseServerSentEvents(response)

Parse a Server-Sent Events (SSE) stream from a `Response` object.

Returns a [`ReadableStream`](https://developer.mozilla.org/docs/Web/API/ReadableStream) that yields parsed events as they arrive. The stream can be consumed using async iteration (`for await...of`) or stream methods like `.pipeTo()`, `.pipeThrough()`, and `.tee()`.

#### response

Type: `Response`

A [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) object with a `text/event-stream` body.

#### Returns

Type: `ReadableStream<ServerSentEvent>`

A stream of parsed events that can be consumed using async iteration or standard stream methods.

### ServerSentEventTransformStream

TransformStream that parses Server-Sent Events.

Use this for advanced stream composition or when you have a text stream that's already decoded.

**Important:** This expects string chunks as input. If you have a byte stream, pipe it through `TextDecoderStream` first.

```js
import {ServerSentEventTransformStream} from 'parse-sse';

// Correct - with TextDecoderStream for bytes
response.body
	.pipeThrough(new TextDecoderStream())
	.pipeThrough(new ServerSentEventTransformStream());

// Correct - if you already have text chunks
myTextStream
	.pipeThrough(new ServerSentEventTransformStream());
```

#### Input

Type: `string`

Text chunks (already decoded from bytes). If you pass byte chunks, a `TypeError` will be thrown.

#### Output

Type: `ServerSentEvent`

Parsed SSE events.

### ServerSentEvent

A parsed Server-Sent Event.

Type: `object`

#### type

Type: `string`\
Default: `'message'`

The event type.

#### data

Type: `string`

The event data.

Multiple `data:` fields are joined with newlines.

#### lastEventId

Type: `string`

The last event ID in the stream.

This is connection-scoped state that persists across events. When an event includes an `id:` field, this value is updated and persists for all subsequent events until changed again.

Always present as a string (empty string if no ID has been set). Matches browser `MessageEvent.lastEventId` behavior.

Used for reconnection with `Last-Event-ID` header.

#### retry

Type: `number | undefined`

The retry interval in milliseconds, if specified.

Indicates how long to wait before reconnecting.

## FAQ

### Why not use [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)?

The browser's built-in `EventSource` API has several limitations:

- Can't set custom headers (like `Authorization`)
- Only supports GET requests
- Doesn't work with the Fetch API
- No support for async iteration
- Can't be used with custom `fetch` implementations

This package works with any `Response` object, giving you full control over the request.

### How is this different from other SSE parsers?

Most SSE parsers either:
- Implement their own HTTP client (limiting flexibility)
- Don't follow the spec correctly (especially for edge cases)
- Have dependencies or large bundle sizes
- Use callbacks instead of streams

This package focuses on doing one thing well: parsing SSE from a standard `Response` object using web platform standards (ReadableStream, TransformStream).

### Can I use this with other HTTP clients?

Yes! Any HTTP client that returns a standard `Response` object will work:

```js
// With Ky
import ky from 'ky';

const response = await ky(url);

// With native fetch
const response = await fetch(url);

// Both work the same way
for await (const event of parseServerSentEvents(response)) {
	console.log(event.data);
}
```

## Related

- [ky](https://github.com/sindresorhus/ky) - Tiny and elegant HTTP client based on Fetch
- [fetch-extras](https://github.com/sindresorhus/fetch-extras) - Useful utilities for working with Fetch
