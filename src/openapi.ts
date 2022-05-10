import _ from 'lodash'
import { PartialDeep } from 'type-fest'
import { OpenAPIV3 } from 'openapi-types'
import { print } from 'graphql'
import { CustomProperties, OpenAPIGraphQLOperation } from './types'

export const createOpenAPISchemaFromOperations = (
  openAPIBaseSchema: PartialDeep<OpenAPIV3.Document>,
  openAPIGraphqlOperation: Array<OpenAPIGraphQLOperation>
) => {
  const openAPIPaths = openAPIGraphqlOperation.map((x) => ({
    paths: {
      [x.path]: {
        [x.httpMethod]: {
          ...x.openAPIOperation,
          [CustomProperties.Operation]: print(x.graphqlDocument),
        },
      },
    },
  }))

  return _.merge({}, openAPIBaseSchema, ...openAPIPaths)
}
