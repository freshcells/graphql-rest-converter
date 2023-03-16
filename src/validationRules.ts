import {
  GraphQLNonNull,
  specifiedRules,
  typeFromAST,
  ValidationRule,
  VariableDefinitionNode,
} from 'graphql'
import { ValidationContext } from 'graphql/validation/ValidationContext'
import {
  getDirective,
  getDirectiveArguments,
  getDirectiveArgumentsWithSchema,
  hasDirective,
} from './graphqlUtils'
import { OpenAPIDirectives } from './graphql'
import { GraphQLError } from 'graphql/error'
import { inspect } from 'graphql/jsutils/inspect'
import { getVariablesFromPathTemplate } from './pathTemplate'
import { getParameterName } from './utils'
import { VariableNode } from 'graphql/index'

const oaBodyValidation: ValidationRule = (context: ValidationContext) => {
  let varDefMap: Record<string, VariableDefinitionNode> = {}

  return {
    OperationDefinition: {
      enter() {
        varDefMap = {}
      },
      leave(operation) {
        const usages = context.getRecursiveVariableUsages(operation)

        const allBodyDirectives = usages
          .map(({ node }) => {
            const varName = node.name.value
            const varDef = varDefMap[varName]
            if (!varDef) {
              return null
            }
            const directiveArguments = getDirectiveArgumentsWithSchema(
              context.getSchema(),
              varDef,
              OpenAPIDirectives.Body
            )
            return directiveArguments
              ? {
                  varDef,
                  node,
                  path: directiveArguments.path || varName,
                }
              : null
          })
          .filter((v) => v) as {
          varDef: VariableDefinitionNode
          node: VariableNode
          path: string
        }[]

        const uniques = allBodyDirectives.reduce((next, { path }) => {
          if (!next.includes(path)) {
            return [...next, path]
          }
          return next
        }, [] as string[])

        const { node, varDef } = allBodyDirectives?.[0] || {}

        if (allBodyDirectives.length > 0 && uniques.length !== allBodyDirectives.length) {
          context.reportError(
            new GraphQLError(`Only unique "@OABody" definitions allowed.`, {
              nodes: [varDef, node, operation],
            })
          )
        }
      },
    },
    VariableDefinition(node: VariableDefinitionNode) {
      varDefMap[node.variable.name.value] = node
    },
  }
}

const oaOperationValidations: ValidationRule = (context: ValidationContext) => {
  let varDefMap: Record<string, VariableDefinitionNode> = {}
  const operationDirective = context.getSchema().getDirective(OpenAPIDirectives.Operation)!
  return {
    OperationDefinition: {
      enter() {
        varDefMap = {}
      },

      leave(operation) {
        const usages = context.getRecursiveVariableUsages(operation)
        const operationDirectiveValue = getDirective(operation, OpenAPIDirectives.Operation)

        if (!operationDirectiveValue) {
          context.reportError(
            new GraphQLError(
              `Missing required directive "@OAOperation" on operation "${operation.name?.value}".`,
              {
                nodes: [operation],
              }
            )
          )
          return
        }

        const directiveArguments = getDirectiveArguments(
          operationDirective,
          operationDirectiveValue
        )
        const pathDefinition = directiveArguments['path']

        const pathVariables = new Set(getVariablesFromPathTemplate(pathDefinition as string))

        if (pathVariables.size > 0) {
          const mapped = usages.filter(({ node }) =>
            pathVariables.has(getParameterName(node, varDefMap[node.name.value]))
          )
          const missing = Array.from(pathVariables.values()).filter(
            (varName) =>
              !mapped.find(
                ({ node }) => getParameterName(node, varDefMap[node.name.value]) === varName
              )
          )
          if (mapped.length !== pathVariables.size) {
            context.reportError(
              new GraphQLError(
                `Not all path variables in "${pathDefinition}" are mapped to variables - Missing mappings are: ${missing
                  .map((v) => `"${v}"`)
                  .join(', ')}.`,
                {
                  nodes: [operation],
                }
              )
            )
            return
          }
        }
        for (const { node, type } of usages) {
          const varName = node.name.value
          const varDef = varDefMap[varName]
          if (!varDef) {
            continue
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

          if (inValue) {
            if (pathVariables.has(parameterName) && inValue !== 'path') {
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
        }
      },
    },
    VariableDefinition(node: VariableDefinitionNode) {
      varDefMap[node.variable.name.value] = node
    },
  }
}

export const gqlValidationRules: ValidationRule[] = [
  ...specifiedRules,
  oaBodyValidation,
  oaOperationValidations,
]
