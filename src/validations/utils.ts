import {
  GraphQLInputType,
  GraphQLNonNull,
  GraphQLSchema,
  OperationDefinitionNode,
  typeFromAST,
  VariableDefinitionNode,
  VariableNode,
} from 'graphql'
import { ValidationContext } from 'graphql/validation/ValidationContext.js'
import { Maybe } from 'graphql/jsutils/Maybe.js'
import { inspect } from 'graphql/jsutils/inspect.js'
import { getParameterName } from '../utils.js'
import { getDirectiveArgumentsWithSchema, hasDirective } from '../graphqlUtils.js'
import { OpenAPIDirectives } from '../graphql.js'
import { GraphQLError } from 'graphql/error'

export const validateVariable = (
  varDefMap: Record<string, VariableDefinitionNode>,
  context: ValidationContext,
  pathVariables: Set<string>,
  node: VariableNode,
  type: Maybe<GraphQLInputType>,
  operation: OperationDefinitionNode,
  pathDefinition: string
) => {
  const varName = node.name.value
  const varDef = varDefMap[varName]
  if (!varDef) {
    return
  }
  const varType = typeFromAST(context.getSchema(), varDef.type)
  const varTypeStr = inspect(varType)

  const parameterName = getParameterName(node, varDef)
  const paramDirectiveArguments = getDirectiveArgumentsWithSchema(
    context.getSchema(),
    varDef,
    OpenAPIDirectives.Param
  )
  const inValue = (paramDirectiveArguments?.in as string | undefined)?.toLowerCase()
  if (pathVariables.has(parameterName)) {
    if (hasDirective(varDef, OpenAPIDirectives.Body)) {
      context.reportError(
        new GraphQLError(
          `Variable "$${varName}" of type "${varTypeStr}" cannot be used with "@OABody", as it is used within "${pathDefinition}".`,
          {
            nodes: [varDef, node, operation],
          }
        )
      )
      return
    }

    if (!(type instanceof GraphQLNonNull)) {
      context.reportError(
        new GraphQLError(
          `Variable "$${varName}" of type "${varTypeStr}" must be defined as "${varTypeStr}!", as it is used within "${pathDefinition}".`,
          {
            nodes: [varDef, node, operation],
          }
        )
      )
      return
    }
  }

  if (inValue && pathVariables.has(parameterName) && inValue !== 'path') {
    context.reportError(
      new GraphQLError(
        `Location "${inValue}" is invalid for "$${varName}" of type "${varTypeStr}", because "${parameterName}" is part of the path "${pathDefinition}".`,
        {
          nodes: [varDef, node, operation],
        }
      )
    )
  }
  if (!pathVariables.has(parameterName) && inValue === 'path') {
    context.reportError(
      new GraphQLError(
        `Location "${inValue}" is invalid for "$${varName}" of type "${varTypeStr}", because "${parameterName}" was expected in "${pathDefinition}".`,
        {
          nodes: [varDef, node, operation],
        }
      )
    )
  }
}

export const getBodyDirectiveInfo = (
  varDefMap: Record<string, VariableDefinitionNode>,
  node: VariableNode,
  schema: GraphQLSchema
) => {
  const varName = node.name.value
  const varDef = varDefMap[varName]
  if (!varDef) {
    return null
  }
  const directiveArguments = getDirectiveArgumentsWithSchema(schema, varDef, OpenAPIDirectives.Body)
  return directiveArguments
    ? {
        varDef,
        node,
        path: directiveArguments.path || varName,
        contentType: directiveArguments.contentType,
      }
    : null
}
