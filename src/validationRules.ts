import { specifiedRules, ValidationRule, VariableDefinitionNode } from 'graphql'
import { ValidationContext } from 'graphql/validation/ValidationContext.js'
import { getDirective, getDirectiveArguments } from './graphqlUtils.js'
import { OpenAPIDirectives } from './graphql.js'
import { GraphQLError } from 'graphql/error'
import { createUniquePathString, getVariablesFromPathTemplate } from './pathTemplate.js'
import { getParameterName } from './utils.js'
import type { VariableNode } from 'graphql'
import { getBodyDirectiveInfo, validateVariable } from './validations/utils.js'

type BodyDirectiveInfo = {
  varDef: VariableDefinitionNode
  node: VariableNode
  contentType: string
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

        const uniquePaths = allBodyDirectives.reduce((next, { path }) => {
          if (!next.includes(path)) {
            return [...next, path]
          }
          return next
        }, [] as string[])

        const { node, varDef } = allBodyDirectives?.[0] || {}

        if (uniquePaths.length !== allBodyDirectives.length) {
          context.reportError(
            new GraphQLError(`Only unique "@OABody(path:...)" definitions allowed.`, {
              nodes: [varDef, node, operation],
            })
          )
        }

        const allContentTypes = allBodyDirectives.reduce((next, { contentType }) => {
          if (!next.includes(contentType)) {
            return [...next, contentType]
          }
          return next
        }, [] as string[])

        if (allBodyDirectives.length > 0 && allContentTypes.length > 1) {
          context.reportError(
            new GraphQLError(
              `Cannot mix different contentType(s) with "@OABody" (found: ${allContentTypes.join(
                ', '
              )}).`,
              {
                nodes: [varDef, node, operation],
              }
            )
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
  let ops = new Set()
  const operationDirective = context.getSchema().getDirective(OpenAPIDirectives.Operation)!
  return {
    Document: {
      enter() {
        ops = new Set()
      },
    },
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
        const pathVarValues = Array.from(pathVariables.values())
        const thisMethod =
          directiveArguments.method || (operation.operation === 'mutation' ? 'POST' : 'GET')
        const opsKey = `${thisMethod} ${createUniquePathString(pathDefinition, pathVarValues)}`

        if (ops.has(opsKey)) {
          context.reportError(
            new GraphQLError(`"@OAOperation" ${opsKey} has already been defined".`, {
              nodes: [operation],
            })
          )
          return
        }

        ops.add(opsKey)

        if (pathVariables.size > 0) {
          const mapped = usages.filter(
            ({ node }) =>
              varDefMap[node.name.value] &&
              pathVariables.has(getParameterName(node, varDefMap[node.name.value]))
          )
          const missing = pathVarValues.filter(
            (varName) =>
              !mapped.find(
                ({ node }) =>
                  varDefMap[node.name.value] &&
                  getParameterName(node, varDefMap[node.name.value]) === varName
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
