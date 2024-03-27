import _ from 'lodash'
import { PartialDeep } from 'type-fest'
import { OpenAPIV3 } from 'openapi-types'
import { BridgeOperations, OAType, CustomOperationProps } from './types.js'

export const createOpenAPISchemaFromOperations = <
  T extends CustomOperationProps = CustomOperationProps,
>(
  openAPIBaseSchema: PartialDeep<OpenAPIV3.Document>,
  openAPIGraphqlOperations: BridgeOperations<T>,
): OpenAPIV3.Document<T> => {
  const openAPIPaths = openAPIGraphqlOperations.operations.map((bridgeOp) => {
    return {
      paths: {
        [bridgeOp.path]: {
          [bridgeOp.httpMethod]: bridgeOp.openAPIOperation,
        },
      },
      components: {
        schemas: openAPIGraphqlOperations.schemaComponents,
      },
    }
  })

  return _.merge({}, openAPIBaseSchema, ...openAPIPaths)
}

export const isNullable = (schema: OAType) => {
  return 'nullable' in schema && schema.nullable
}
