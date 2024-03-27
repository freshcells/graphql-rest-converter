import {
  CustomOperationProps,
  CustomProperties,
  OpWithProps,
  ParamsWithVars,
  ReqBodyWithVars,
  SchemaTransformer,
} from './types.js'
import { OpenAPIV3 } from 'openapi-types'

export const transform = <T extends CustomOperationProps = CustomOperationProps>(
  ...transformers: SchemaTransformer<T>[]
) => {
  return (operation: OpenAPIV3.OperationObject<T>) =>
    transformers.reduce((operation, transform) => {
      return transform(operation)
    }, operation)
}

type WithParameter = (OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject) & {
  [CustomProperties.VariableName]: string
}

export const removeCustomProperties = <T extends CustomOperationProps = CustomOperationProps>(
  operation: OpenAPIV3.OperationObject<T>,
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
        },
      ),
    },
  }

  if (restOperation.requestBody) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const requestBody = restOperation.requestBody as ReqBodyWithVars
    const contentType = Object.keys((requestBody as OpenAPIV3.RequestBodyObject).content)[0]

    // remove possible custom attributes in properties
    const media = (requestBody as OpenAPIV3.RequestBodyObject).content?.[contentType]

    const propertiesWithoutCustomEntries = Object.fromEntries(
      Object.entries((media?.schema as OpenAPIV3.NonArraySchemaObject)?.properties || {})?.map(
        ([key, entry]) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [CustomProperties.VariableName]: customVar, ...restEntry } =
            entry as WithParameter
          return [[key], restEntry]
        },
      ),
    )

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [CustomProperties.VariableName]: customVar, ...restSchema } = (media?.schema ||
      {}) as WithParameter

    return {
      ...baseOp,
      requestBody: {
        ...requestBody,
        content: {
          ...(requestBody as OpenAPIV3.RequestBodyObject).content,
          [contentType]: {
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
