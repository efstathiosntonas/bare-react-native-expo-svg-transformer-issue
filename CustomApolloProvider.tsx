import React, {PropsWithChildren, useMemo} from 'react';
import {
  ApolloClient,
  ApolloLink,
  ApolloProvider,
  HttpLink,
  InMemoryCache,
  split,
} from '@apollo/client';
import {BatchHttpLink} from '@apollo/client/link/batch-http';
import {createClient} from 'graphql-ws';
import {getMainDefinition} from '@apollo/client/utilities';
import {GraphQLWsLink} from '@apollo/client/link/subscriptions';
import {RetryLink} from '@apollo/client/link/retry';
import {setContext} from '@apollo/client/link/context';
import {onError} from '@apollo/client/link/error';

export const errorLink = onError(
  ({graphQLErrors, networkError, response, forward, operation}) => {
    if (graphQLErrors) {
      for (const error of graphQLErrors) {
        console.log(
          `[GraphQL error]: Message: ${JSON.stringify(
            error.message,
            null,
            4,
          )}, Location: ${JSON.stringify(error.extensions.code)}`,
          JSON.stringify(operation, null, 4),
          JSON.stringify(response, null, 4),
        );
      }
    }
    if (networkError) {
      console.log(
        `[Network error]: ${JSON.stringify(networkError, null, 4)}`,
        `[Operation]: ${JSON.stringify(operation, null, 4)}`,
        `[Response]: ${JSON.stringify(response, null, 4)}`,
      );
    }
  },
);

const uri = 'http://192.168.178.47:9091/v1/graphql';

const webSocketUri = 'ws://192.168.178.47:9091/v1/graphql';

const retryLink = new RetryLink({
  attempts: {
    max: 15,
    // eslint-disable-next-line @typescript-eslint/require-await
    retryIf: async error => {
      return !!error;
    },
  },
  delay: {
    initial: 1000,
    max: Infinity,
    jitter: true,
  },
});

const retry401ErrorLink = new RetryLink({
  attempts: {
    max: 3,
    retryIf: error => {
      return error && error.statusCode === 401;
    },
  },
  delay: {
    initial: 20000, // Initial delay in milliseconds (20 seconds)
    max: Infinity,
    jitter: false,
  },
});

const CustomApolloProvider = ({children}: PropsWithChildren<unknown>) => {
  const client = useMemo(() => {
    const authLink = setContext(async (_, {headers}) => {
      return {
        headers: {
          ...headers,
          Authorization: `Bearer `,
        },
      };
    });

    const httpLink = new HttpLink({
      uri,
    });

    const batchLink = new BatchHttpLink({
      uri,
      batchMax: 20, // No more than 20 operations per batch
      batchInterval: 200, // Wait no more than 20ms after first batched operation
    });

    let timedOut: any;

    const wsLink = new GraphQLWsLink(
      createClient({
        url: webSocketUri,
        lazy: true,
        shouldRetry: () => true,
        retryAttempts: Infinity,
        retryWait: _count => new Promise(r => setTimeout(() => r(), 1000)),
        on: {
          ping: received => {
            if (!received /* sent */) {
              timedOut = setTimeout(() => {
                /* a close event `4499: Terminated` is issued to the current WebSocket and an
                 artificial `{ code: 4499, reason: 'Terminated', wasClean: false }` close-event-like
                 object is immediately emitted without waiting for the one coming from `WebSocket.onclose`
                 calling terminate is not considered fatal and a connection retry will occur as expected
                 see: https://github.com/enisdenjo/graphql-ws/discussions/290
                 */
                wsLink.client.terminate();
              }, 5000);
            }
          },
          pong: received => {
            if (received) {
              clearTimeout(timedOut);
            }
          },
          error: (err: any) => {
            console.log(
              `error in sockets, code: ${err.code}, reason: ${err.reason}`,
            );
          },
        },
        connectionParams: async () => {
          return {
            headers: {
              Authorization: `Bearer `,
            },
          };
        },
      }),
    );

    const batchOrHttp = split(
      ({query, getContext}) => {
        const definition = getMainDefinition(query);
        return (
          definition.kind === 'OperationDefinition' &&
          definition.operation === 'mutation' &&
          getContext().batch
        );
      },
      batchLink,
      httpLink,
    );

    const splitLink = split(
      ({query}) => {
        const definition = getMainDefinition(query);
        return (
          definition.kind === 'OperationDefinition' &&
          definition.operation === 'subscription'
        );
      },
      wsLink,
      batchOrHttp,
    );

    const apollo = new ApolloClient({
      link: ApolloLink.from([
        authLink,
        errorLink,
        retryLink,
        retry401ErrorLink,
        // cancelRequestLink,
        splitLink,
      ]),
      cache: new InMemoryCache(),
      defaultOptions: {
        watchQuery: {
          fetchPolicy: 'cache-and-network',
          nextFetchPolicy: 'cache-first',
        },
      },
      assumeImmutableResults: true,
    });

    return apollo;
  }, []);

  return <ApolloProvider client={client}>{children}</ApolloProvider>;
};

export default CustomApolloProvider;
