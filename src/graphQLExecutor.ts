import { execute, parse, GraphQLSchema } from 'graphql'
import { GraphQLClient } from 'graphql-request'

export type GraphQLExecutor = (args: {
  document: string
  variables: { [key: string]: any }
}) => Promise<any>

export const createHttpExecutor = (
  ...args: ConstructorParameters<typeof GraphQLClient>
): GraphQLExecutor => {
  const client = new GraphQLClient(...args)
  return ({ document, variables }) => client.request({ document, variables })
}

export const createSchemaExecutor = (schema: GraphQLSchema): GraphQLExecutor => {
  return ({ document, variables }) =>
    Promise.resolve(execute({ schema, document: parse(document), variableValues: variables })).then(
      (x) => x.data
    )
}
