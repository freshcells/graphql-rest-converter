import _ from 'lodash'
import { PartialDeep } from 'type-fest'
import { OpenAPIV3 } from 'openapi-types'
import { CustomProperties, BridgeOperations, OAType } from './types'

export const createOpenAPISchemaFromOperations = (
  openAPIBaseSchema: PartialDeep<OpenAPIV3.Document>,
  openAPIGraphqlOperations: BridgeOperations
): OpenAPIV3.Document => {
  const openAPIPaths = openAPIGraphqlOperations.operations.map((x) => ({
    paths: {
      [x.path]: {
        [x.httpMethod]: {
          ...x.openAPIOperation,
          [CustomProperties.Operation]: x.graphqlDocumentSource,
        },
      },
    },
    components: {
      schemas: openAPIGraphqlOperations.schemaComponents,
    },
  }))

  return _.merge({}, openAPIBaseSchema, ...openAPIPaths)
}

export const isNullable = (schema: OAType) => {
  return 'nullable' in schema && schema.nullable
}
