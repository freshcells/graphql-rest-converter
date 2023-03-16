import {
  BridgeOperation,
  CustomOperationProps,
  CustomProperties,
  JSON_CONTENT_TYPE,
  OpWithProps,
  ParamsWithVars,
  ReqBodyWithVars,
  SchemaTransformer,
} from './types'
import { OpenAPIV3 } from 'openapi-types'

export const transform = <T extends CustomOperationProps = CustomOperationProps>(
  ...transformers: SchemaTransformer<T>[]
) => {
  return (bridgeOperation: BridgeOperation<T>, operation: OpenAPIV3.OperationObject<T>) =>
    transformers.reduce((operation, transform) => {
      return transform(bridgeOperation, operation)
    }, operation)
}

type WithParameter = (OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject) & {
  [CustomProperties.VariableName]: string
}

export const removeCustomProperties = <T extends CustomOperationProps = CustomOperationProps>(
  bridgeOperation: BridgeOperation<T>,
  operation: OpenAPIV3.OperationObject<T>
): OpenAPIV3.OperationObject<T> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [CustomProperties.Operation]: customOp, ...restOperation } = operation

  const baseOp = {
    ...restOperation,
    ...{
      parameters: ((restOperation as OpWithProps).parameters as ParamsWithVars)?.map(
        (parameter) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [CustomProperties.VariableName]: customParam, ...rest } = parameter
          return rest
        }
      ),
    },
  }

  if (restOperation.requestBody) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const requestBody = restOperation.requestBody as ReqBodyWithVars

    // remove possible custom attributes in properties
    const media = (requestBody as OpenAPIV3.RequestBodyObject).content?.[JSON_CONTENT_TYPE]

    const propertiesWithoutCustomEntries = Object.entries(
      (media?.schema as OpenAPIV3.NonArraySchemaObject)?.properties || {}
    )?.reduce((next, [key, entry]) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [CustomProperties.VariableName]: customVar, ...restEntry } = entry as WithParameter
      return {
        ...next,
        [key]: restEntry,
      }
    }, {} as OpenAPIV3.NonArraySchemaObject['properties'])

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [CustomProperties.VariableName]: customVar, ...restSchema } = (media?.schema ||
      {}) as WithParameter

    return {
      ...baseOp,
      requestBody: {
        ...requestBody,
        content: {
          ...(requestBody as OpenAPIV3.RequestBodyObject).content,
          [JSON_CONTENT_TYPE]: {
            ...media,
            schema: {
              ...restSchema,
              properties: propertiesWithoutCustomEntries,
            },
          },
        },
      },
    } as OpenAPIV3.OperationObject<T>
  }
  return baseOp as OpenAPIV3.OperationObject<T>
}
