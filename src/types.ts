import { DocumentNode } from 'graphql'
import { OpenAPIV3 } from 'openapi-types'
import { PartialDeep } from 'type-fest'

export type PartialOpenAPIDocument = PartialDeep<OpenAPIV3.Document>

export type OpenAPIGraphQLOperation = {
  openAPIOperation: OpenAPIV3.OperationObject
  path: string
  httpMethod: OpenAPIV3.HttpMethods
  graphqlDocument: DocumentNode
}

export type OAType = OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject

export type SchemaComponents = Record<string, OpenAPIV3.SchemaObject>

export type OpenAPIGraphQLOperations = {
  operations: Array<OpenAPIGraphQLOperation>
  schemaComponents: SchemaComponents
}

export enum CustomProperties {
  Operation = 'x-graphql-operation',
}
