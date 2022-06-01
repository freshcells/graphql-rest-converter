import _ from 'lodash'
import { PartialDeep } from 'type-fest'
import { OpenAPIV3 } from 'openapi-types'
import { print } from 'graphql'
import { CustomProperties, OpenAPIGraphQLOperations } from './types'

export const createOpenAPISchemaFromOperations = (
  openAPIBaseSchema: PartialDeep<OpenAPIV3.Document>,
  openAPIGraphqlOperations: OpenAPIGraphQLOperations
) => {
  const openAPIPaths = openAPIGraphqlOperations.operations.map((x) => ({
    paths: {
      [x.path]: {
        [x.httpMethod]: {
          ...x.openAPIOperation,
          [CustomProperties.Operation]: print(x.graphqlDocument),
        },
      },
    },
    components: {
      schemas: openAPIGraphqlOperations.schemaComponents,
    },
  }))

  return _.merge({}, openAPIBaseSchema, ...openAPIPaths)
}
