import { DocumentNode } from 'graphql'
import { OpenAPIV3 } from 'openapi-types'
import { ExecutionResult, GraphQLSchema } from 'graphql'
import { PartialDeep } from 'type-fest'
import { GraphQLExecutorArgs } from './graphQLExecutor.js'
import { IncomingMessage } from 'node:http'
import { ServerResponse } from 'http'

export const JSON_CONTENT_TYPE = 'application/json'
export const MULTIPART_FORM_DATA_CONTENT_TYPE = 'multipart/form-data'
export const FORM_DATA_CONTENT_TYPE = 'application/x-www-form-urlencoded'

export const MediaTypeMap = {
  JSON: JSON_CONTENT_TYPE,
  MULTIPART_FORM_DATA: MULTIPART_FORM_DATA_CONTENT_TYPE,
  FORM_DATA: FORM_DATA_CONTENT_TYPE,
} as const

export type BridgeOperation<T extends CustomOperationProps = CustomOperationProps> = {
  openAPIOperation: OpenAPIV3.OperationObject<T>
  path: string
  httpMethod: OpenAPIV3.HttpMethods
  graphqlDocument: DocumentNode
  graphqlDocumentSource: string
  variableMap: Record<string, string>
  requestBodyVariableMap: Record<string, string>
  requestBodyIsSingleInput?: boolean
  requestBodyFormData?: 'JSON' | 'FORM_DATA' | 'MULTIPART_FORM_DATA'
}

export type OAType = OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject

export type SchemaComponents = Record<string, OpenAPIV3.SchemaObject>

export type ParameterCustomProperties = {
  [CustomProperties.VariableName]?: string
}

export type ResponseTransformerArgs<
  T extends IncomingMessage = IncomingMessage,
  S extends ServerResponse = ServerResponse<T>
> = {
  result: ExecutionResult
  request: GraphQLExecutorArgs<T, S>
  openAPISchema: {
    operation: OpenAPIV3.OperationObject
    method: OpenAPIV3.HttpMethods
    path: string
  }
}

export type CreateMiddlewareConfig<
  T extends IncomingMessage = IncomingMessage,
  S extends ServerResponse = ServerResponse
> = {
  responseTransformer?: ResponseTransformer<T, S>
  /**
   * Default is `true`
   */
  validateRequest?: boolean
  /**
   * Default is `false`
   */
  validateResponse?: boolean
}

export type ResponseTransformer<
  T extends IncomingMessage = IncomingMessage,
  S extends ServerResponse = ServerResponse<T>
> = (args: ResponseTransformerArgs<T, S>) => Promise<ResponseTransformerResult | void>

export type ResponseTransformerResult = {
  statusCode: number
  contentType?: string
  data?: string | Buffer
}

export type CreateOpenAPISchemaConfig<T extends CustomOperationProps = CustomOperationProps> = {
  baseSchema: PartialDeep<OpenAPIV3.Document<T>>
  validate?: boolean
}

export type CreateOpenAPIGraphQLBridgeConfig<
  T extends CustomOperationProps = CustomOperationProps
> = {
  graphqlSchema: GraphQLSchema | string
  graphqlDocument: DocumentNode | string
  customScalars?: (scalarTypeName: string) => OpenAPIV3.SchemaObject
  transform?: (operation: OpenAPIV3.OperationObject<T>) => OpenAPIV3.OperationObject<T>
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
  operation: OpenAPIV3.OperationObject<T>
) => OpenAPIV3.OperationObject<T>

export enum CustomProperties {
  Operation = 'x-graphql-operation',
  VariableName = 'x-graphql-variable-name',
}
