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
} from 'graphql'
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
import { CustomProperties, OAType, OpenAPIGraphQLOperation } from './types'
import { getReferenceableFragments, GraphQLTypeToOpenAPITypeSchemaConverter } from './typeConverter'

const DIRECTIVE_DEFINITION = gql`
  input OAExternalDocsInput {
    url: String!
    description: String
  }

  enum HTTPVerb {
    POST
    PUT
    DELETE
  }

  enum ParameterSource {
    PATH
    QUERY
    HEADER
  }

  directive @OAQuery(
    path: String!
    tags: [String!]
    summary: String
    description: String
    externalDocs: OAExternalDocsInput
    deprecated: Boolean
  ) on QUERY

  directive @OAParam(
    in: ParameterSource
    deprecated: Boolean
    description: String
    name: String
  ) on VARIABLE_DEFINITION

  directive @OAMutation(
    path: String!
    tags: [String!]
    summary: String
    description: String
    externalDocs: OAExternalDocsInput
    deprecated: Boolean
    "defaults to POST"
    httpVerb: HTTPVerb
  ) on MUTATION

  directive @OABody(
    "Assume variable name if undefined"
    path: String
    deprecated: Boolean
    description: String
  ) on VARIABLE_DEFINITION

  directive @OAMap(to: String, from: String) on INPUT_FIELD_DEFINITION | VARIABLE_DEFINITION
`

enum OpenAPIDirectives {
  Query = 'OAQuery',
  Param = 'OAParam',
  Mutation = 'OAMutation',
  Body = 'OABody',
  Map = 'OAMap',
}

const graphqlQueryDirectiveDataToOpenAPIOperation = (requestConfig: OpenAPIQueryDirectiveData) => {
  const { tags, summary, description, externalDocs, deprecated } = requestConfig
  return {
    ...(tags?.length ? { tags } : {}),
    ...(typeof summary === 'string' ? { summary } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof externalDocs?.url === 'string' ? { externalDocs } : {}),
    ...(deprecated ? { deprecated } : {}),
  }
}

const getOpenAPIParameters = (
  parameters: Omit<OpenAPIV3.ParameterObject, 'in'>[],
  path: string,
  variablesDirectiveData: Record<string, OpenAPIParamDirectiveData>
) => {
  const adjustedParameters: OpenAPIV3.ParameterObject[] = []
  const variableMap: Record<string, string> = {}

  const pathVariables = new Set(getVariablesFromPathTemplate(path))
  for (const parameter of parameters) {
    const variableName = parameter.name
    const variableDirectiveData = variablesDirectiveData[variableName]
    let parameterName = variableName
    const nameOverride = variableDirectiveData.name
    if (nameOverride) {
      parameterName = nameOverride
    }
    const variableDirectiveDataIn = variableDirectiveData.in?.toLowerCase()

    if (variableDirectiveDataIn) {
      if (pathVariables.has(parameterName) && variableDirectiveDataIn !== 'path') {
        throw new Error(
          `Location ${variableDirectiveDataIn} invalid for parameter ${parameterName} because it is part of the path`
        )
      }
      if (!pathVariables.has(parameterName) && variableDirectiveDataIn === 'path') {
        throw new Error(
          `Location ${variableDirectiveDataIn} invalid for parameter ${parameterName} because it is not part of the path`
        )
      }
      if (variableDirectiveDataIn === 'cookie') {
        throw new Error(`Unsupported parameter location cookie for parameter ${parameterName}`)
      }
      if (!['path', 'query', 'header'].includes(variableDirectiveDataIn)) {
        throw new Error(
          `Unknown parameter location ${variableDirectiveDataIn} for parameter ${parameterName}`
        )
      }
    }
    if (variableDirectiveDataIn && variableDirectiveDataIn === 'header') {
      parameterName = parameterName.toLowerCase()
    }
    if (parameterName !== variableName) {
      variableMap[parameterName] = variableName
    }

    const in_ = pathVariables.has(parameterName)
      ? 'path'
      : variableDirectiveDataIn && ['header', 'cookie'].includes(variableDirectiveDataIn)
      ? variableDirectiveDataIn
      : 'query'
    const deprecated = variableDirectiveData.deprecated
    const description = variableDirectiveData.description
    adjustedParameters.push({
      ...parameter,
      in: in_,
      name: parameterName,
      ...(nameOverride ? { [CustomProperties.VariableName]: parameter.name } : {}),
      ...(deprecated === true ? { deprecated } : {}),
      ...(description ? { description } : {}),
    })
  }

  return {
    parameters: adjustedParameters,
    variableMap,
  }
}

type OpenAPIQueryDirectiveData = {
  path: string
  tags?: [string]
  summary?: string
  description?: string
  externalDocs?: {
    url: string
    description?: string
  }
  deprecated?: boolean
}

type OpenAPIParamDirectiveData = {
  in?: string
  deprecated?: boolean
  description?: string
  name?: string
}

const createOpenAPIOperation = (
  operationId: string | null,
  operationSource: string,
  parameters: OpenAPIV3.ParameterObject[],
  responseSchema: OAType,
  queryDirectiveData: OpenAPIQueryDirectiveData
) => {
  const responses = {
    '200': {
      description: 'Success',
      content: {
        'application/json': {
          schema: responseSchema,
        },
      },
    },
    '400': {
      description: 'Invalid request',
      content: {
        'application/json': {},
      },
    },
  }
  return {
    ...(operationId !== null ? { operationId } : {}),
    [CustomProperties.Operation]: operationSource,
    ...graphqlQueryDirectiveDataToOpenAPIOperation(queryDirectiveData),
    parameters,
    responses,
  }
}

const getVariablesDirectiveData = (
  directive: GraphQLDirective,
  operation: OperationDefinitionNode
) => {
  const result: Record<string, OpenAPIParamDirectiveData> = {}
  for (const variableDefinition of operation.variableDefinitions || []) {
    const paramDirective = getDirective(variableDefinition, OpenAPIDirectives.Param)
    result[variableDefinition.variable.name.value] = paramDirective
      ? (getDirectiveArguments(directive, paramDirective) as OpenAPIParamDirectiveData)
      : {}
  }
  return result
}

export const getOpenAPIGraphQLOperations = (
  schema: GraphQLSchema,
  document: DocumentNode,
  customScalars?: (scalarTypeName: string) => OpenAPIV3.SchemaObject
) => {
  const result: Array<OpenAPIGraphQLOperation> = []

  const fragmentMap = createFragmentMap(document.definitions)

  const fragmentDependencies = getFragmentDependencies(fragmentMap)

  const referencableFragments = getReferenceableFragments(schema, fragmentMap, document)

  const typeConverter = new GraphQLTypeToOpenAPITypeSchemaConverter(
    schema,
    customScalars,
    fragmentMap,
    referencableFragments
  )

  const directiveSchema = buildASTSchema(DIRECTIVE_DEFINITION)

  for (const operation of document.definitions) {
    if (!isOperationDefinitionNode(operation)) {
      continue
    }

    const queryDirective = getDirective(operation, OpenAPIDirectives.Query)
    if (!queryDirective) {
      continue
    }

    const queryDirectiveData = getDirectiveArguments(
      directiveSchema.getDirective(OpenAPIDirectives.Query)!,
      queryDirective
    ) as OpenAPIQueryDirectiveData

    const variablesDirectiveData = getVariablesDirectiveData(
      directiveSchema.getDirective(OpenAPIDirectives.Param)!,
      operation
    )

    const operation_ = removeOpenAPIDirectives(operation)

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

    const parametersSchema = typeConverter.parametersFromOperation(operation_)

    const responseSchema = typeConverter.responseSchemaFromOperation(operation_)

    const { parameters, variableMap } = getOpenAPIParameters(
      parametersSchema,
      queryDirectiveData.path,
      variablesDirectiveData
    )

    const operationSource = print(singleOperationDocument)

    const openAPIOperation = createOpenAPIOperation(
      operationId,
      operationSource,
      parameters,
      responseSchema,
      queryDirectiveData
    )

    const graphqlOpenAPIOperation = {
      openAPIOperation,
      httpMethod: OpenAPIV3.HttpMethods.GET,
      graphqlDocument: singleOperationDocument,
      variableMap,
      path: queryDirectiveData.path,
    }
    result.push(graphqlOpenAPIOperation)
  }

  return {
    operations: result,
    schemaComponents: typeConverter.getSchemaComponents(),
  }
}

const removeOpenAPIDirectives = <T extends ASTNode>(node: T): T => {
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
