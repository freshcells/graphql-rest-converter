import { execute, parse, GraphQLSchema, ExecutionResult } from 'graphql'
import { GraphQLClient } from 'graphql-request'
import { IncomingMessage } from 'node:http'

export type GraphQLExecutorArgs<R extends IncomingMessage = IncomingMessage> = {
  document: string
  variables: { [key: string]: unknown }
  request: R
}

export type GraphQLExecutor = <R extends IncomingMessage>(
  args: GraphQLExecutorArgs<R>
) => Promise<ExecutionResult>

type ExecutorArgs = ConstructorParameters<typeof GraphQLClient>

export const createHttpExecutor = (
  url: ExecutorArgs[0],
  requestConfig: ExecutorArgs[1]
): GraphQLExecutor => {
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

export const createSchemaExecutor = (schema: GraphQLSchema): GraphQLExecutor => {
  return ({ document, variables }) =>
    Promise.resolve(execute({ schema, document: parse(document), variableValues: variables }))
}
