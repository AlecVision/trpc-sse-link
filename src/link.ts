import {
  HTTPLinkOptions,
  OperationContext,
  OperationResultEnvelope,
  TRPCClientError,
  TRPCClientRuntime,
  TRPCLink
} from "@trpc/client";
import { transformResult } from "@trpc/client/shared";
import { AnyRouter, getTRPCErrorFromUnknown } from "@trpc/server";
import { Observer, observable } from "@trpc/server/observable";
import { TRPCResponseMessage } from "@trpc/server/rpc";
import { ParseEvent, createParser } from "eventsource-parser";
import { getBody, getUrl, resolveSSELinkOptions, sseRequest } from "./sseUtils";

//TODO: Use `getErrorShape` from @trpc/server/shared for error handling?
export function sseLink<TRouter extends AnyRouter>(
  opts: HTTPLinkOptions
): TRPCLink<TRouter> {
  const resolvedOpts = resolveSSELinkOptions(opts);

  return runtime =>
    ({ op }) =>
      observable(observer => {
        const { path, type, input, id, context } = op;
        const { promise, cancel } = sseRequest({
          ...resolvedOpts,
          runtime,
          type,
          path,
          input,
          getBody,
          getUrl,
          id,
          headers() {
            const headers = {
              "X-JSONRPC-ID": id.toString(),
              "Content-Type": "application/json"
            };
            if (!opts.headers) {
              return headers;
            }
            if (typeof opts.headers === "function") {
              return Object.assign(headers, opts.headers({ op }));
            }
            return Object.assign(headers, opts.headers);
          }
        });

        promise
          .then(async res => {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            const parser = createObservableParser(observer, runtime, context);

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              parser.feed(decoder.decode(value));
            }

            reader.releaseLock();
          })
          .catch(err => {
            observer.error(TRPCClientError.from(getTRPCErrorFromUnknown(err)));
          })
          .finally(() => observer.complete());

        return () => {
          cancel();
          observer.complete();
        };
      });
}

function createObservableParser<
  TObserver extends Observer<
    OperationResultEnvelope<unknown>,
    TRPCClientError<any>
  >
>(observer: TObserver, runtime: TRPCClientRuntime, context?: OperationContext) {
  return createParser((data: ParseEvent) => {
    if (data.type === "reconnect-interval") {
      // TODO: Handle reconnect-interval events?
    }

    if (data.type === "event") {
      const eventData = data.data;
      const parsed = JSON.parse(eventData) as TRPCResponseMessage<unknown>;
      const transformed = transformResult(parsed, runtime);

      if (!transformed.ok) {
        return observer.error(
          TRPCClientError.from(getTRPCErrorFromUnknown(transformed.error.error))
        );
      }

      const result = transformed.result;

      switch (result.type) {
        case "started": {
          // TODO: Handle started events?
          break;
        }
        case "data": {
          observer.next({
            result,
            ...(context && { context })
          });
          break;
        }
        case "stopped": {
          observer.complete();
          break;
        }
      }
    }
  });
}
