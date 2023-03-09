import { execute, parse, GraphQLSchema, ExecutionResult } from 'graphql'
import { GraphQLClient } from 'graphql-request'
import type { IncomingMessage } from 'node:http'

export type GraphQLExecutorArgs<R extends IncomingMessage = IncomingMessage> = {
  document: string
  variables: { [key: string]: unknown }
  request: R
}

export type GraphQLExecutor<R extends IncomingMessage = IncomingMessage> = <
  T extends IncomingMessage = R
>(
  args: GraphQLExecutorArgs<T>
) => Promise<ExecutionResult>

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

export const createSchemaExecutor = <R extends IncomingMessage>(
  schema: GraphQLSchema
): GraphQLExecutor<R> => {
  return ({ document, variables }) =>
    Promise.resolve(execute({ schema, document: parse(document), variableValues: variables }))
}
