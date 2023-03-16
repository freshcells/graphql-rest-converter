import { DocumentNode } from 'graphql'
import { OpenAPIV3 } from 'openapi-types'
import { ExecutionResult, GraphQLSchema } from 'graphql/index'
import { PartialDeep } from 'type-fest'
import { GraphQLExecutorArgs } from './graphQLExecutor'
import { IncomingMessage } from 'node:http'

export type BridgeOperation<T extends CustomOperationProps = CustomOperationProps> = {
  openAPIOperation: OpenAPIV3.OperationObject<T>
  path: string
  httpMethod: OpenAPIV3.HttpMethods
  graphqlDocument: DocumentNode
  graphqlDocumentSource: string
  variableMap: Record<string, string>
  requestBodyVariableMap: Record<string, string>
  requestBodyIsSingleInput?: boolean
}

export type OAType = OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject

export type SchemaComponents = Record<string, OpenAPIV3.SchemaObject>

export type ParameterCustomProperties = {
  [CustomProperties.VariableName]?: string
}

export type ResponseTransformerArgs<T extends IncomingMessage = IncomingMessage> = {
  result: ExecutionResult
  request: GraphQLExecutorArgs<T>
  openAPISchema: {
    operation: OpenAPIV3.OperationObject
    method: OpenAPIV3.HttpMethods
    path: string
  }
}

export type CreateMiddlewareConfig<T extends IncomingMessage = IncomingMessage> = {
  responseTransformer?: ResponseTransformer<T>
  /**
   * Default is `true`
   */
  validateRequest?: boolean
  /**
   * Default is `false`
   */
  validateResponse?: boolean
}

export type ResponseTransformer<T extends IncomingMessage = IncomingMessage> = (
  args: ResponseTransformerArgs<T>
) => Promise<ResponseTransformerResult | void>

export type ResponseTransformerResult = {
  statusCode: number
  contentType?: string
  data?: string | Buffer
}

export type CreateOpenAPISchemaConfig<T extends CustomOperationProps = CustomOperationProps> = {
  baseSchema: PartialDeep<OpenAPIV3.Document<T>>
  validate?: boolean
  transform?: (
    bridgeOperation: BridgeOperation<T>,
    operation: OpenAPIV3.OperationObject<T>
  ) => OpenAPIV3.OperationObject<T>
}

export type CreateOpenAPIGraphQLBridgeConfig = {
  graphqlSchema: GraphQLSchema | string
  graphqlDocument: DocumentNode | string
  customScalars?: (scalarTypeName: string) => OpenAPIV3.SchemaObject
}

export type CustomOperationProps = {
  [CustomProperties.Operation]?: string
}

export type BridgeOperations<T extends CustomOperationProps = CustomOperationProps> = {
  operations: Array<BridgeOperation<T>>
  schemaComponents: SchemaComponents
}

export type OpWithProps = OpenAPIV3.OperationObject<CustomOperationProps>
export type ParamsWithVars = ((OpenAPIV3.ReferenceObject | OpenAPIV3.ParameterObject) &
  ParameterCustomProperties)[]
export type ReqBodyWithVars = (OpenAPIV3.ReferenceObject | OpenAPIV3.RequestBodyObject) &
  ParameterCustomProperties

export type SchemaTransformer<T extends CustomOperationProps = CustomOperationProps> = (
  bridgeOperation: BridgeOperation<T>,
  operation: OpenAPIV3.OperationObject<T>
) => OpenAPIV3.OperationObject<T>

export enum CustomProperties {
  Operation = 'x-graphql-operation',
  VariableName = 'x-graphql-variable-name',
}
