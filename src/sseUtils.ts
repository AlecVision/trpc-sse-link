import {
  type HTTPHeaders,
  type TRPCClientRuntime,
  TRPCClientError,
  getFetch
} from "@trpc/client";
import {
  type ResponseEsque,
  type AbortControllerEsque,
  type RequestInitEsque,
  type FetchEsque
} from "@trpc/client/dist/internals/types";
import { type Maybe, TRPCError } from "@trpc/server";

interface HeadersEsque {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(
    callbackfn: (value: string, key: string) => void,
    thisArg?: any
  ): void;
}
declare module "@trpc/client/dist/internals/types" {
  interface ResponseEsque {
    readonly headers: HeadersEsque;
    readonly ok: boolean;
    readonly redirected: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly type: ResponseType;
    readonly url: string;
    clone(): ResponseEsque;
  }
}

interface SSEResult {
  body: ReadableStream<Uint8Array>;
  meta: { response: ResponseEsque };
}

type GetBody = typeof getBody;
type GetUrl = typeof getUrl;

type ContentOptions = {
  contentTypeHeader?: string;
  getUrl: GetUrl;
  getBody: GetBody;
};

type SSEBaseRequestOptions = ReturnType<typeof resolveSSELinkOptions> &
  GetInputOptions & {
    type: "subscription" | "mutation" | "query";
    path: string;
    id: number;
    url: string;
    fetch: FetchEsque;
    AbortController: AbortControllerEsque | null;
  };

type GetInputOptions = {
  runtime: TRPCClientRuntime;
  input: unknown;
};

type SSERequestOptions = SSEBaseRequestOptions &
  ContentOptions & {
    headers: () => HTTPHeaders | Promise<HTTPHeaders>;
  };

const METHOD = {
  query: "GET",
  subscription: "PATCH",
  mutation: "POST"
} as const;

export function getUrl(opts: SSEBaseRequestOptions) {
  // add the id as a query param - other params are unsupported by this link
  return `${opts.url}/${opts.path}?id=${opts.id}`;
}

export function getBody(opts: SSEBaseRequestOptions): RequestInitEsque["body"] {
  const input = getInput(opts);
  return input !== undefined ? JSON.stringify(input) : undefined;
}

export function resolveSSELinkOptions(opts: {
  url: string;
  fetch?: FetchEsque;
  AbortController?: AbortControllerEsque | null;
}) {
  return {
    url: opts.url,
    fetch: getFetch(opts.fetch),
    AbortController: getAbortController(opts.AbortController)
  };
}

export function sseRequest(opts: SSERequestOptions) {
  const { type, contentTypeHeader } = opts;
  const ac = opts.AbortController ? new opts.AbortController() : null;
  const promise = new Promise<SSEResult>(async (resolve, reject) => {
    const headers = await opts.headers();
    const url = opts.getUrl(opts);
    const body = opts.getBody(opts);
    const meta = {} as SSEResult["meta"];

    unstable_assert_subscription(opts);

    const requestInit: RequestInit = {
      method: METHOD[type],
      signal: ac?.signal ?? null,
      body: body ?? null,
      headers: {
        ...(contentTypeHeader && { "Content-Type": contentTypeHeader }),
        ...headers
      }
    };

    try {
      const { body } = await opts.fetch(url, requestInit).then(res => {
        if (res.status >= 400) throw new TRPCClientError(res.statusText);
        unstable_assert_stream_body(res);
        meta.response = res;
        return res;
      });

      resolve({
        meta,
        body
      });
    } catch (err) {
      reject(err);
    }
  });

  return {
    promise,
    cancel() {
      ac?.abort();
    }
  };
}

//TODO: Use `getErrorShape` from @trpc/server/shared for error handling
function getAbortController(
  customAbortControllerImpl: Maybe<AbortControllerEsque>
): AbortControllerEsque | null {
  if (customAbortControllerImpl) return customAbortControllerImpl;
  const ctx = typeof window !== "undefined" ? window : globalThis;
  return ctx?.AbortController ?? null;
}

function getInput(opts: GetInputOptions) {
  return opts.runtime.transformer.serialize(opts.input);
}

function unstable_assert_subscription<T extends SSERequestOptions>(
  opts: T
): asserts opts is T & { type: "subscription" } {
  if (opts.type === "subscription") return;
  throw TRPCClientError.from(
    new TRPCError({
      code: "METHOD_NOT_SUPPORTED",
      message: "Only subscriptions are supported by SSELink"
    })
  );
}

function unstable_assert_stream_body(
  res: ResponseEsque
): asserts res is typeof res & { body: ReadableStream<Uint8Array> } {
  if ("body" in res && res.body instanceof ReadableStream) return;
  throw TRPCClientError.from(
    new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Response body is not a stream"
    })
  );
}

/* c8 ignore start */
//@ts-expect-error - Vite handles this import.meta check
if (import.meta.vitest) {
  //@ts-expect-error - Vite handles this top-level await
  const [{ describe }] = await Promise.all([import("vitest")]);
  describe("sseUtils", it => {
    it("should work", async ({ expect }) => {
      expect(true).toBe(true);
    });
  });
}
