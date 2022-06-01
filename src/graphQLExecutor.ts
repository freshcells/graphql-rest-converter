import { execute, parse, GraphQLSchema, GraphQLError, ExecutionResult } from 'graphql'
import { ClientError, GraphQLClient } from 'graphql-request'

export type GraphQLExecutorArgs = {
  document: string
  variables: { [key: string]: any }
}

export type GraphQLExecutor = (args: GraphQLExecutorArgs) => Promise<ExecutionResult>

export const createHttpExecutor = (
  ...args: ConstructorParameters<typeof GraphQLClient>
): GraphQLExecutor => {
  const client = new GraphQLClient(...args)
  return async ({ document, variables }) => {
    try {
      // TODO: Use `errorPolicy: 'all'` when released
      return client.rawRequest({ query: document, variables })
    } catch (e) {
      if (e instanceof ClientError) {
        return e.response as ExecutionResult
      }
      throw e
    }
  }
}

export const createSchemaExecutor = (schema: GraphQLSchema): GraphQLExecutor => {
  return ({ document, variables }) =>
    Promise.resolve(execute({ schema, document: parse(document), variableValues: variables }))
}
