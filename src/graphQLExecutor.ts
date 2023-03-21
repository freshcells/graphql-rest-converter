import { execute, parse, GraphQLSchema, ExecutionResult } from 'graphql'
import { GraphQLClient } from 'graphql-request'
import type { IncomingMessage } from 'node:http'
import { ServerResponse } from 'http'

export type GraphQLExecutorArgs<
  Request extends IncomingMessage = IncomingMessage,
  Response extends ServerResponse = ServerResponse<Request>
> = {
  document: string
  variables: { [key: string]: unknown }
  request: Request
  response: Response
}

export type GraphQLExecutor<
  Request extends IncomingMessage = IncomingMessage,
  Response extends ServerResponse = ServerResponse<Request>
> = (args: GraphQLExecutorArgs<Request, Response>) => Promise<ExecutionResult>

type ExecutorArgs = ConstructorParameters<typeof GraphQLClient>

export const createHttpExecutor = <R extends IncomingMessage>(
  url: ExecutorArgs[0],
  requestConfig: ExecutorArgs[1]
): GraphQLExecutor<R> => {
  const client = new GraphQLClient(url, {
    ...requestConfig,
    errorPolicy: 'all',
  })
  return async ({ document, variables }) => {
    return (await client.rawRequest({
      query: document,
      variables,
    })) as ExecutionResult
  }
}

export const createSchemaExecutor = <
  Request extends IncomingMessage,
  Response extends ServerResponse = ServerResponse<Request>
>(
  schema: GraphQLSchema
): GraphQLExecutor<Request, Response> => {
  return ({ document, variables }) =>
    Promise.resolve(execute({ schema, document: parse(document), variableValues: variables }))
}
