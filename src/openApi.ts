import _ from 'lodash'
import { PartialDeep } from 'type-fest'
import { OpenAPIV3 } from 'openapi-types'
import {
  CustomProperties,
  BridgeOperations,
  OAType,
  BridgeOperation,
  CustomOperationProps,
} from './types.js'

export const createOpenAPISchemaFromOperations = <
  T extends CustomOperationProps = CustomOperationProps
>(
  openAPIBaseSchema: PartialDeep<OpenAPIV3.Document>,
  openAPIGraphqlOperations: BridgeOperations<T>,
  transformSchema?: (
    bridgeOperation: BridgeOperation<T>,
    operation: OpenAPIV3.OperationObject<T>
  ) => OpenAPIV3.OperationObject<T>
): OpenAPIV3.Document<T> => {
  const openAPIPaths = openAPIGraphqlOperations.operations.map((bridgeOp) => {
    const operation = Object.freeze({
      ...bridgeOp.openAPIOperation,
      [CustomProperties.Operation]: bridgeOp.graphqlDocumentSource,
    }) as OpenAPIV3.OperationObject<T>
    return {
      paths: {
        [bridgeOp.path]: {
          [bridgeOp.httpMethod]: transformSchema ? transformSchema(bridgeOp, operation) : operation,
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
