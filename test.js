import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseServerSentEvents, ServerSentEventTransformStream} from './index.js';

// Helper to create a mock Response with SSE data
function createResponse(data) {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(data));
			controller.close();
		},
	});

	return new Response(stream);
}

// Helper to collect all events
async function collectEvents(response) {
	const events = [];
	for await (const event of parseServerSentEvents(response)) {
		events.push(event);
	}

	return events;
}

test('basic message', async () => {
	const response = createResponse('data: hello\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'message');
	assert.equal(events[0].data, 'hello');
	assert.equal(events[0].lastEventId, ''); // No id: field set yet
	assert.equal(events[0].retry, undefined);
});

test('multiple messages', async () => {
	const response = createResponse('data: first\n\ndata: second\n\ndata: third\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 3);
	assert.equal(events[0].data, 'first');
	assert.equal(events[1].data, 'second');
	assert.equal(events[2].data, 'third');
});

test('multi-line data', async () => {
	const response = createResponse('data: line 1\ndata: line 2\ndata: line 3\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'line 1\nline 2\nline 3');
});

test('event type', async () => {
	const response = createResponse('event: update\ndata: some data\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'update');
	assert.equal(events[0].data, 'some data');
});

test('event id', async () => {
	const response = createResponse('id: 123\ndata: message\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].lastEventId, '123');
	assert.equal(events[0].data, 'message');
});

test('retry field', async () => {
	const response = createResponse('retry: 5000\ndata: message\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].retry, 5000);
	assert.equal(events[0].data, 'message');
});

test('all fields combined', async () => {
	const response = createResponse('event: update\nid: 42\nretry: 3000\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'update');
	assert.equal(events[0].lastEventId, '42');
	assert.equal(events[0].retry, 3000);
	assert.equal(events[0].data, 'test');
});

test('comments are ignored', async () => {
	const response = createResponse(': comment\ndata: message\n: another comment\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'message');
});

test('leading space in value is removed', async () => {
	const response = createResponse('data:  hello\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, ' hello'); // Only first space is removed
});

test('value without leading space', async () => {
	const response = createResponse('data:hello\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'hello');
});

test('empty data field is not dispatched', async () => {
	const response = createResponse('data:\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 0);
});

test('CRLF line endings', async () => {
	const response = createResponse('data: hello\r\n\r\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'hello');
});

test('CR line endings', async () => {
	const response = createResponse('data: hello\r\r');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'hello');
});

test('mixed line endings', async () => {
	const response = createResponse('data: first\r\n\r\ndata: second\n\ndata: third\r\r');
	const events = await collectEvents(response);

	assert.equal(events.length, 3);
	assert.equal(events[0].data, 'first');
	assert.equal(events[1].data, 'second');
	assert.equal(events[2].data, 'third');
});

test('event type resets after dispatch', async () => {
	const response = createResponse('event: custom\ndata: first\n\ndata: second\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 2);
	assert.equal(events[0].type, 'custom');
	assert.equal(events[1].type, 'message'); // Should reset to default
});

test('invalid retry is ignored', async () => {
	const response = createResponse('retry: invalid\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].retry, undefined);
});

test('field without colon is ignored', async () => {
	const response = createResponse('invalid field\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'test');
});

test('unknown field is ignored', async () => {
	const response = createResponse('unknown: value\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'test');
});

test('empty event without data is not dispatched', async () => {
	const response = createResponse('\n\ndata: test\n\n\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'test');
});

test('JSON data parsing', async () => {
	const response = createResponse('data: {"message":"hello","count":42}\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	const parsed = JSON.parse(events[0].data);
	assert.equal(parsed.message, 'hello');
	assert.equal(parsed.count, 42);
});

test('OpenAI-style [DONE] message', async () => {
	const response = createResponse('data: {"delta":"text"}\n\ndata: [DONE]\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 2);
	assert.equal(events[1].data, '[DONE]');
});

test('chunked data across multiple reads', async () => {
	const encoder = new TextEncoder();
	const chunks = [
		'data: part',
		' 1\ndata: par',
		't 2\n\n',
	];

	let chunkIndex = 0;
	const stream = new ReadableStream({
		start(controller) {
			const interval = setInterval(() => {
				if (chunkIndex < chunks.length) {
					controller.enqueue(encoder.encode(chunks[chunkIndex++]));
				} else {
					clearInterval(interval);
					controller.close();
				}
			}, 10);
		},
	});

	const response = new Response(stream);
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'part 1\npart 2');
});

test('throws TypeError for response without body', async () => {
	await assert.rejects(
		async () => {
			for await (const _ of parseServerSentEvents({body: null})) {
				// Should not reach here
			}
		},
		{
			name: 'TypeError',
			message: 'Expected response to have a body',
		},
	);
});

test('handles final event without trailing newline', async () => {
	const response = createResponse('data: hello');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'hello');
});

test('preserves event state across chunks', async () => {
	const encoder = new TextEncoder();
	const chunks = [
		'event: update\n',
		'id: 123\n',
		'data: message\n',
		'\n',
	];

	let chunkIndex = 0;
	const stream = new ReadableStream({
		start(controller) {
			const interval = setInterval(() => {
				if (chunkIndex < chunks.length) {
					controller.enqueue(encoder.encode(chunks[chunkIndex++]));
				} else {
					clearInterval(interval);
					controller.close();
				}
			}, 10);
		},
	});

	const response = new Response(stream);
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'update');
	assert.equal(events[0].lastEventId, '123');
	assert.equal(events[0].data, 'message');
});

test('strips BOM from start of stream', async () => {
	const response = createResponse('\uFEFFdata: hello\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'hello');
});

test('BOM in middle of stream is part of data', async () => {
	const response = createResponse('data: first\n\ndata: \uFEFFsecond\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 2);
	assert.equal(events[0].data, 'first');
	assert.equal(events[1].data, '\uFEFFsecond');
});

test('ignores id field with NULL character', async () => {
	const response = createResponse('id: test\0null\ndata: message\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].lastEventId, ''); // NULL character causes id: field to be ignored, lastEventId remains empty
	assert.equal(events[0].data, 'message');
});

test('accepts id field without NULL character', async () => {
	const response = createResponse('id: valid-id\ndata: message\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].lastEventId, 'valid-id');
});

test('field without colon is ignored', async () => {
	const response = createResponse('fieldwithoutcolon\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'test');
});

test('empty event type defaults to message', async () => {
	const response = createResponse('event:\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'message');
});

test('empty retry value is ignored', async () => {
	const response = createResponse('retry:\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].retry, undefined);
});

test('invalid retry value with trailing text is ignored', async () => {
	const response = createResponse('retry: 2000x\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].retry, undefined);
});

test('multiple spaces after colon only first is stripped', async () => {
	const response = createResponse('data:  two spaces\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, ' two spaces');
});

test('handles unicode emoji in data', async () => {
	const response = createResponse('data: Hello 👋 World 🌍\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'Hello 👋 World 🌍');
});

test('handles multibyte characters', async () => {
	const response = createResponse('data: 你好世界\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, '你好世界');
});

test('handles large message', async () => {
	const largeData = 'x'.repeat(100_000);
	const response = createResponse(`data: ${largeData}\n\n`);
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, largeData);
});

test('colon in field value is preserved', async () => {
	const response = createResponse('data: http://example.com\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'http://example.com');
});

test('data field with only colon is not dispatched', async () => {
	const response = createResponse('data:\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 0);
});

test('data field with colon and space is not dispatched', async () => {
	const response = createResponse('data: \n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 0);
});

test('stream with only comments yields no events', async () => {
	const response = createResponse(': comment 1\n: comment 2\n: comment 3\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 0);
});

test('comment without trailing newline yields no events', async () => {
	const response = createResponse(': comment without newline');
	const events = await collectEvents(response);

	assert.equal(events.length, 0);
});

test('empty stream yields no events', async () => {
	const response = createResponse('');
	const events = await collectEvents(response);

	assert.equal(events.length, 0);
});

test('multiple consecutive blank lines', async () => {
	const response = createResponse('data: test\n\n\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'test');
});

test('blank lines between events', async () => {
	const response = createResponse('data: first\n\n\n\ndata: second\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 2);
	assert.equal(events[0].data, 'first');
	assert.equal(events[1].data, 'second');
});

test('ServerSentEventTransformStream throws on byte chunks', async () => {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode('data: test\n\n'));
			controller.close();
		},
	});

	const response = new Response(stream);

	await assert.rejects(
		async () => {
			// eslint-disable-next-line no-unused-vars
			for await (const event of response.body.pipeThrough(new ServerSentEventTransformStream())) {
				// Should not reach here
			}
		},
		{
			name: 'TypeError',
			message: 'ServerSentEventTransformStream expects string chunks. Pipe through TextDecoderStream first for byte streams.',
		},
	);
});

test('field with only whitespace is treated as unknown field', async () => {
	const response = createResponse('   \ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].data, 'test');
});

test('event persists across multiple data fields until blank line', async () => {
	const response = createResponse('event: update\ndata: line1\ndata: line2\ndata: line3\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].type, 'update');
	assert.equal(events[0].data, 'line1\nline2\nline3');
});

test('lastEventId persists across multiple events', async () => {
	const response = createResponse('id: 123\ndata: first\n\ndata: second\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 2);
	assert.equal(events[0].lastEventId, '123'); // First event sets lastEventId
	assert.equal(events[1].lastEventId, '123'); // Second event inherits lastEventId (per spec)
});

test('lastEventId updates when new id field appears', async () => {
	const response = createResponse('id: 123\ndata: first\n\nid: 456\ndata: second\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 2);
	assert.equal(events[0].lastEventId, '123'); // First event has lastEventId: 123
	assert.equal(events[1].lastEventId, '456'); // Second event updates lastEventId to 456
});

test('empty id value resets lastEventId to empty string', async () => {
	const response = createResponse('id: 123\ndata: first\n\nid:\ndata: second\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 2);
	assert.equal(events[0].lastEventId, '123');
	assert.equal(events[1].lastEventId, ''); // Empty id: resets lastEventId to empty string
});

test('multiple id fields in same event - last wins', async () => {
	const response = createResponse('id: first\nid: second\nid: third\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].lastEventId, 'third'); // Last id: wins
});

test('lastEventId from non-dispatched event persists to next event', async () => {
	const response = createResponse('id: 123\n\ndata: test\n\n');
	const events = await collectEvents(response);

	assert.equal(events.length, 1);
	assert.equal(events[0].lastEventId, '123'); // LastEventId persists from non-dispatched event (per spec)
});
