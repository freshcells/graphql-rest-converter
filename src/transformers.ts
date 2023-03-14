import {
  BridgeOperation,
  CustomOperationProps,
  CustomProperties,
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

export const removeCustomProperties = <T extends CustomOperationProps = CustomOperationProps>(
  bridgeOperation: BridgeOperation<T>,
  operation: OpenAPIV3.OperationObject<T>
): OpenAPIV3.OperationObject<T> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [CustomProperties.Operation]: customOp, ...restOperation } = operation

  const baseOp = {
    ...restOperation,
    ...(restOperation.parameters
      ? {
          parameters: ((restOperation as OpWithProps).parameters as ParamsWithVars)?.filter(
            (p) => !(CustomProperties.VariableName in p)
          ),
        }
      : {}),
  }

  if (restOperation.requestBody) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [CustomProperties.VariableName]: customReqBody, ...restRequestBody } = (
      restOperation as OpWithProps
    ).requestBody as ReqBodyWithVars
    return {
      ...baseOp,
      requestBody: restRequestBody,
    } as OpenAPIV3.OperationObject<T>
  }
  return baseOp as OpenAPIV3.OperationObject<T>
}
