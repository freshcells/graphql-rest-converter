import { DocumentNode } from 'graphql'
import { OpenAPIV3 } from 'openapi-types'
import { PartialDeep } from 'type-fest'

export type PartialOpenAPIDocument = PartialDeep<OpenAPIV3.Document>

export type BridgeOperation = {
  openAPIOperation: OpenAPIV3.OperationObject
  path: string
  httpMethod: OpenAPIV3.HttpMethods
  graphqlDocument: DocumentNode
  variableMap: Record<string, string>
  requestBodyVariable: string | null
}

export type OAType = OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject

export type SchemaComponents = Record<string, OpenAPIV3.SchemaObject>

export type BridgeOperations = {
  operations: Array<BridgeOperation>
  schemaComponents: SchemaComponents
}

export enum CustomProperties {
  Operation = 'x-graphql-operation',
  VariableName = 'x-graphql-variable-name',
}
