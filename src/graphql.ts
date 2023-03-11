import _ from 'lodash'
import {
  DocumentNode,
  GraphQLSchema,
  visit,
  print,
  Kind,
  ASTNode,
  buildASTSchema,
  OperationDefinitionNode,
  GraphQLDirective,
  OperationTypeNode,
  validate,
} from 'graphql'
import { mergeSchemas } from '@graphql-tools/schema'
import { gql } from 'graphql-tag'
import { OpenAPIV3 } from 'openapi-types'
import { getVariablesFromPathTemplate } from './pathTemplate'
import {
  createFragmentMap,
  getDependencyClosure,
  getDirective,
  getDirectiveArguments,
  getFragmentDependencies,
  getReferencedFragments,
  isOperationDefinitionNode,
} from './graphqlUtils'
import { CustomProperties, OAType, BridgeOperation } from './types'
import { getReferenceableFragments, GraphQLTypeToOpenAPITypeSchemaConverter } from './typeConverter'
import { isNullable } from './openApi'
import { printSourceLocation } from 'graphql/language/printLocation'

const DIRECTIVE_DEFINITION = gql`
  input OAExternalDocsInput {
    url: String!
    description: String
  }

  # see https://swagger.io/docs/specification/authentication/
  input SecurityDefinitionInput {
    schema: String!
    scopes: [String!]
  }

  enum HttpMethod {
    GET
    POST
    PUT
    DELETE
  }

  enum ParameterSource {
    PATH
    QUERY
    HEADER
  }

  directive @OAOperation(
    path: String!
    tags: [String!]
    summary: String
    security: [SecurityDefinitionInput]
    description: String
    externalDocs: OAExternalDocsInput
    deprecated: Boolean
    "defaults to GET"
    method: HttpMethod
  ) on QUERY | MUTATION

  directive @OAParam(
    in: ParameterSource
    deprecated: Boolean
    description: String
    required: Boolean
    name: String
  ) on VARIABLE_DEFINITION

  directive @OABody(description: String) on VARIABLE_DEFINITION

  directive @OADescription(
    description: String
  ) on FRAGMENT_DEFINITION | FIELD | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
`

export enum OpenAPIDirectives {
  Operation = 'OAOperation',
  Param = 'OAParam',
  Body = 'OABody',
  Description = 'OADescription',
}

const graphqlOperationDirectiveDataToOpenAPIOperation = (
  requestConfig: OpenAPIOperationDirectiveData
) => {
  const { tags, summary, description, externalDocs, security, deprecated } = requestConfig
  return {
    ...(tags?.length ? { tags } : {}),
    ...(typeof summary === 'string' ? { summary } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof externalDocs?.url === 'string' ? { externalDocs } : {}),
    ...(deprecated ? { deprecated } : {}),
    ...(security
      ? {
          security: security.map((item) => {
            if (item === null) {
              return {}
            }
            return { [item.schema]: item.scopes || [] }
          }),
        }
      : {}),
  }
}

const getOpenAPIParameters = (
  variablesSchema: Record<string, OAType>,
  path: string,
  paramsDirectiveData: Record<string, OpenAPIParamDirectiveData>
) => {
  const parameters: OpenAPIV3.ParameterObject[] = []
  const variableMap: Record<string, string> = {}

  const pathVariables = new Set(getVariablesFromPathTemplate(path))

  for (const [variableName, paramDirectiveData] of Object.entries(paramsDirectiveData)) {
    let parameterName = variableName
    const nameOverride = paramDirectiveData.name
    if (nameOverride) {
      parameterName = nameOverride
    }
    const paramDirectiveDataIn = paramDirectiveData.in?.toLowerCase()

    if (paramDirectiveDataIn) {
      if (pathVariables.has(parameterName) && paramDirectiveDataIn !== 'path') {
        throw new Error(
          `Location ${paramDirectiveDataIn} invalid for parameter ${parameterName} because it is part of the path`
        )
      }
      if (!pathVariables.has(parameterName) && paramDirectiveDataIn === 'path') {
        throw new Error(
          `Location ${paramDirectiveDataIn} invalid for parameter ${parameterName} because it is not part of the path`
        )
      }
      if (paramDirectiveDataIn === 'cookie') {
        throw new Error(`Unsupported parameter location cookie for parameter ${parameterName}`)
      }
      if (!['path', 'query', 'header'].includes(paramDirectiveDataIn)) {
        throw new Error(
          `Unknown parameter location ${paramDirectiveDataIn} for parameter ${parameterName}`
        )
      }
    }
    if (paramDirectiveDataIn && paramDirectiveDataIn === 'header') {
      parameterName = parameterName.toLowerCase()
    }
    if (parameterName !== variableName) {
      variableMap[parameterName] = variableName
    }

    const in_ = pathVariables.has(parameterName)
      ? 'path'
      : paramDirectiveDataIn && ['header', 'cookie'].includes(paramDirectiveDataIn)
      ? paramDirectiveDataIn
      : 'query'
    const deprecated = paramDirectiveData.deprecated
    const description = paramDirectiveData.description
    const required = paramDirectiveData.required
    const schema = variablesSchema[variableName]
    parameters.push({
      in: in_,
      name: parameterName,
      schema,
      ...(isNullable(schema) ? { required: true } : {}),
      ...(nameOverride ? { [CustomProperties.VariableName]: variableName } : {}),
      ...(deprecated === true ? { deprecated } : {}),
      ...(description ? { description } : {}),
      // path parameters are always required (see https://swagger.io/docs/specification/describing-parameters/)
      ...(in_ === 'path' ? { required: true } : { required: required || false }),
    })
  }

  return {
    parameters,
    variableMap,
  }
}

const getOpenAPIRequestBody = (
  variablesSchema: Record<string, OAType>,
  variableName: string,
  bodyDirectiveData: OpenAPIBodyDirectiveData
) => {
  const description = bodyDirectiveData.description
  return {
    content: {
      'application/json': {
        schema: variablesSchema[variableName],
      },
    },
    ...(description ? { description } : {}),
    [CustomProperties.VariableName]: variableName,
  }
}

type OpenAPIOperationDirectiveData = {
  path: string
  tags?: [string]
  summary?: string
  description?: string
  externalDocs?: {
    url: string
    description?: string
  }
  security?: [
    {
      schema: string
      scopes: string[]
    } | null
  ]
  deprecated?: boolean
  method: OpenAPIV3.HttpMethods
}

type OpenAPIParamDirectiveData = {
  in?: string
  deprecated?: boolean
  description?: string
  required?: boolean
  name?: string
}

type OpenAPIBodyDirectiveData = {
  description?: string
}

const createOpenAPIOperation = (
  operationId: string | null,
  operationSource: string,
  parameters: OpenAPIV3.ParameterObject[],
  requestBody: OpenAPIV3.RequestBodyObject | null,
  resultSchema: OAType,
  operationDirectiveData: OpenAPIOperationDirectiveData
) => {
  const responses = {
    '200': {
      description: 'Success',
      content: {
        'application/json': {
          schema: resultSchema,
        },
      },
    },
    '400': {
      description: 'Invalid request',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    errorCode: { type: 'string' },
                    location: { type: 'string' },
                    message: { type: 'string' },
                    path: { type: 'string' },
                  },
                },
              },
            },
          } as OpenAPIV3.SchemaObject,
        },
      },
    },
    '500': {
      description: 'Internal Server Error',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              data: {
                ...resultSchema,
                nullable: true,
                description: 'Branch of data that does not contain errors',
              },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    locations: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          line: { type: 'integer' },
                          column: { type: 'integer' },
                        },
                      },
                    },
                    message: { type: 'string' },
                    path: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          } as OpenAPIV3.SchemaObject,
        },
      },
    },
  }
  return {
    ...(operationId !== null ? { operationId } : {}),
    [CustomProperties.Operation]: operationSource,
    ...graphqlOperationDirectiveDataToOpenAPIOperation(operationDirectiveData),
    parameters,
    ...(requestBody !== null ? { requestBody } : {}),
    responses,
  }
}

const getVariablesDirectiveData = (
  paramDirectiveDefinition: GraphQLDirective,
  bodyDirectiveDefinition: GraphQLDirective,
  operation: OperationDefinitionNode
) => {
  const paramsDirectiveData: Record<string, OpenAPIParamDirectiveData> = {}
  const bodiesDirectiveData: Record<string, OpenAPIParamDirectiveData> = {}

  for (const variableDefinition of operation.variableDefinitions || []) {
    const bodyDirective = getDirective(variableDefinition, OpenAPIDirectives.Body)
    if (bodyDirective) {
      bodiesDirectiveData[variableDefinition.variable.name.value] = getDirectiveArguments(
        bodyDirectiveDefinition,
        bodyDirective
      ) as OpenAPIBodyDirectiveData
      continue
    }
    const paramDirective = getDirective(variableDefinition, OpenAPIDirectives.Param)
    paramsDirectiveData[variableDefinition.variable.name.value] = paramDirective
      ? (getDirectiveArguments(
          paramDirectiveDefinition,
          paramDirective
        ) as OpenAPIParamDirectiveData)
      : {}
  }

  return {
    paramsDirectiveData,
    bodiesDirectiveData,
  }
}

const directiveSchema = buildASTSchema(DIRECTIVE_DEFINITION)

export const getBridgeOperations = (
  schema: GraphQLSchema,
  document: DocumentNode,
  customScalars?: (scalarTypeName: string) => OpenAPIV3.SchemaObject
) => {
  const bridgeOperations: Array<BridgeOperation> = []

  const fragmentMap = createFragmentMap(document.definitions)

  const fragmentDependencies = getFragmentDependencies(fragmentMap)

  const referencableFragments = getReferenceableFragments(schema, fragmentMap, document)

  const typeConverter = new GraphQLTypeToOpenAPITypeSchemaConverter(
    schema,
    customScalars,
    fragmentMap,
    referencableFragments
  )
  const validationResult = validate(mergeSchemas({ schemas: [directiveSchema, schema] }), document)
  if (validationResult.length > 0) {
    const errors = validationResult
      .map(
        (error) =>
          `${error.message} Source: ${
            error.locations && error.source
              ? printSourceLocation(error.source, error.locations[0])
              : 'unknown'
          }`
      )
      .join(', ')
    throw new Error(`Schema validation error(s): ${errors}`)
  }

  for (const operation of document.definitions) {
    if (!isOperationDefinitionNode(operation)) {
      continue
    }

    const operationDirective = getDirective(operation, OpenAPIDirectives.Operation)
    if (!operationDirective) {
      continue
    }

    // # Extract all directives

    const operationDirectiveData = getDirectiveArguments(
      directiveSchema.getDirective(OpenAPIDirectives.Operation)!,
      operationDirective
    ) as OpenAPIOperationDirectiveData

    const { paramsDirectiveData, bodiesDirectiveData } = getVariablesDirectiveData(
      directiveSchema.getDirective(OpenAPIDirectives.Param)!,
      directiveSchema.getDirective(OpenAPIDirectives.Body)!,
      operation
    )

    // # Compile stand-alone document

    // ## Remove custom directives

    const operation_ = operation

    // ## Include dependency fragments

    const operationFragmentDependencies = getDependencyClosure(
      getReferencedFragments(operation_),
      fragmentDependencies
    )
    const referencedFragments = Object.values(
      _.pickBy(fragmentMap, (v, k) => operationFragmentDependencies.has(k))
    )

    const singleOperationDocument = {
      kind: Kind.DOCUMENT,
      definitions: [operation_, ...referencedFragments],
    } as DocumentNode

    const operationId = operation_.name ? operation_.name.value : null

    // # Extract types from GraphQL operation

    const variablesSchema = typeConverter.variablesFromOperation(operation_)

    const resultSchema = typeConverter.resultFromOperation(operation_)

    // # Build OpenAPI schema

    // ## Build OpenAPI schema: Parameters

    const { parameters, variableMap } = getOpenAPIParameters(
      variablesSchema,
      operationDirectiveData.path,
      paramsDirectiveData
    )

    // ## Build OpenAPI schema: Request body

    const bodyVariables = Object.keys(bodiesDirectiveData)
    if (bodyVariables.length > 1) {
      throw new Error('Only one "OABody" variable allowed')
    }
    const requestBodyVariable = bodyVariables.length === 1 ? bodyVariables[0] : null
    const requestBody = requestBodyVariable
      ? getOpenAPIRequestBody(
          variablesSchema,
          requestBodyVariable,
          bodiesDirectiveData[requestBodyVariable]
        )
      : null

    const graphqlDocument = removeOpenAPIDirectives(singleOperationDocument)
    const operationSource = print(graphqlDocument)

    // ## Build OpenAPI schema: Operation

    const openAPIOperation = createOpenAPIOperation(
      operationId,
      operationSource,
      parameters,
      requestBody,
      resultSchema,
      operationDirectiveData
    )

    // # Build bridge operation

    const defaultHttpMethod =
      operation_.operation === OperationTypeNode.MUTATION
        ? OpenAPIV3.HttpMethods.POST
        : OpenAPIV3.HttpMethods.GET

    const httpMethod =
      (operationDirectiveData.method?.toLowerCase() as OpenAPIV3.HttpMethods | undefined) ??
      defaultHttpMethod

    const bridgeOperation = {
      openAPIOperation,
      path: operationDirectiveData.path,
      httpMethod,
      graphqlDocument,
      graphqlDocumentSource: operationSource,
      variableMap,
      requestBodyVariable,
    }

    bridgeOperations.push(bridgeOperation)
  }

  return {
    operations: bridgeOperations,
    schemaComponents: typeConverter.getSchemaComponents(),
  }
}

export const removeOpenAPIDirectives = <T extends ASTNode>(node: T): T => {
  return visit(node, {
    Directive: {
      enter(node) {
        if (Object.values(OpenAPIDirectives).includes(node.name.value as OpenAPIDirectives)) {
          return null
        }
      },
    },
  })
}
