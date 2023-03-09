import { GraphQLError } from 'graphql/error'

export class InvalidResponseError extends Error {
  validationErrors: readonly string[]
  graphqlErrors?: ReadonlyArray<GraphQLError>

  constructor(
    message: string,
    validationErrors: readonly string[],
    graphqlErrors?: ReadonlyArray<GraphQLError>
  ) {
    super(message)
    this.validationErrors = validationErrors
    this.graphqlErrors = graphqlErrors
  }
}
