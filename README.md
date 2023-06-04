# tRPC Fetch-SSE Link

Because tRPC transmits data as JSON, sending (and subscribing to) individual Server-Sent event streams is not possible by default (which is handy if, say, you want to use SSE to send chunks of a ChatGPT response as they are generated). This link enables that functionality.

</br>

## Table of Contents

- [Usage](#usage)
  - [Adding the Link](#adding-the-link)
  - [Consuming SSE Stream Procedures](#consuming-sse-stream-procedures)
- [License](#license)
- [Author](#author)

</br>

## Usage

> See [the `trpc-sse-adapter` package](https://github.com/alecvision/trpc-sse-adapter) for the server-side adapter needed to handle SSE stream requests.

First, install the link:

```bash
npm install @alecvision/trpc-sse-link
```

There are two steps to implementing this link:

1. Add the link in your tRPC client config and tell it which procedures are SSE streams
2. Consume the SSE subscription using the same API as you would a WebSocket subscription

</br>

### Adding the Link

---

This link ONLY handles requests for SSE streams. To use this link, you will need to use [`splitLink`](https://trpc.io/docs/links/splitLink). Because tRPC doesn't know the difference between a WebSocket and an SSE stream, you must tell it which procedures are SSE streams route them to the appropriate link. For example, using Next.js:

```ts
import { httpBatchLink, loggerLink, splitLink, wsLink } from "@trpc/client";
import superjson from "superjson";
import { createTRPCNext } from "@trpc/next";
import { sseLink } from "@alecvision/trpc-sse-link";
import type { AppRouter } from "../server/trpc";

const SSE_PROCEDURE_PATTERNS = [
  /ticker\.start$/,
  /chatgpt\.generate$/,
  /*
    prefixes/suffixes are an easy way to arbitrarily define SSE streams by giving
    them a special name (e.g. `myProcedure.stream_getSomeStreamingData`)
    */
  /^.*\.stream_\w+$/
];

// This MUST return the same value as is returned by the equivalent server-side function
function isStreamable(path: string) {
  return SSE_PROCEDURE_PATTERNS.some(regex => regex.test(path));
}

export const api = createTRPCNext<AppRouter>({
  config() {
    return {
      transformer: superjson,
      links: [
        loggerLink(/* ... */), // optional
        splitLink({
          condition: ({ type }) => type === "subscription",
          // non-subscription requests go through a normal http link
          false: httpBatchLink(/* ... */), // or httpLink( /* ... */ )
          // the nested splitLink is only necessary if you have both SSE and WebSocket subscription procedures.
          // If you only have SSE subscriptions, you can just use sseLink for handling all subscriptions.
          true: splitLink({
            condition: ({ path }) => isStreamable(path),
            true: sseLink(/* ... */),
            false: wsLink(/* ... */)
          })
        })
      ]
    };
  },
  ssr: false // This link has not been tested with SSR
});
```

</br>

### Consuming SSE Stream Procedures

> **Note** >
>
> The sum of the chunks sent will NOT be sent by the server when the stream is complete. It is up to you to store the chunks in state and reconstruct the response. This can be done on the client (as shown here) or on the server (e.g. to store the result in a database)

Use the same API as you would for a WebSocket subscription to consume the stream. For example:

```jsx
import { useState } from "react";
import { api } from "../utils/trpc";

export default function App() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");

  api.chat.generate.useSubscription(
    {
      model: "gpt-4",
      messages: [
        { role: "user", content: "What are the five funniest words you know?" }
      ],
      temperature: 1.0
    },
    {
      // Control the stream with this boolean
      enabled: isStreaming,
      // This callback is called for each chunk of data sent by the server.
      onData(data) {
        // The sum of the chunks will NOT be sent by the server. It is up to you to reconstruct the full response.
        setStreamedContent(() => streamedContent + data);
      },
      // This callback is called when the server sends the first chunk of data
      onStarted() {
        setIsDone(false);
      },
      // This callback is called when something goes wrong
      onError(err) {
        setIsDone(true);
      }
    }
  );

  return (
    <div>
      <button disabled={isStreaming} onClick={() => setIsStreaming(true)}>
        Get Random Words
      </button>
      <p>{streamedContent}</p>
      {/* shows after the first stream is complete */}
      {isDone && <p>Wow, those are some great words!</p>}
    </div>
  );
}
```

</br>

## License

ISC License (ISC)

</br>

## Author

Alec Helmturner
