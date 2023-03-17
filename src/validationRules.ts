import { specifiedRules, ValidationRule, VariableDefinitionNode } from 'graphql'
import { ValidationContext } from 'graphql/validation/ValidationContext'
import { getDirective, getDirectiveArguments } from './graphqlUtils'
import { OpenAPIDirectives } from './graphql'
import { GraphQLError } from 'graphql/error'
import { getVariablesFromPathTemplate } from './pathTemplate'
import { getParameterName } from './utils'
import type { VariableNode } from 'graphql'
import { getBodyDirectiveInfo, validateVariable } from './validations/utils'

type BodyDirectiveInfo = {
  varDef: VariableDefinitionNode
  node: VariableNode
  path: string
}[]

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
          .map(({ node }) => getBodyDirectiveInfo(varDefMap, node, context.getSchema()))
          .filter((v) => v) as BodyDirectiveInfo

        const uniques = allBodyDirectives.reduce((next, { path }) => {
          if (!next.includes(path)) {
            return [...next, path]
          }
          return next
        }, [] as string[])

        const { node, varDef } = allBodyDirectives?.[0] || {}

        if (uniques.length !== allBodyDirectives.length) {
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

const oaOperationValidation: ValidationRule = (context: ValidationContext) => {
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
        const pathDefinition = directiveArguments.path as string

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
          validateVariable(varDefMap, context, pathVariables, node, type, operation, pathDefinition)
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
  oaOperationValidation,
]
