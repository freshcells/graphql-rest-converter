import {
  GraphQLNonNull,
  specifiedRules,
  typeFromAST,
  ValidationRule,
  VariableDefinitionNode,
} from 'graphql'
import { ValidationContext } from 'graphql/validation/ValidationContext'
import { getDirective, getDirectiveArguments } from './graphqlUtils'
import { OpenAPIDirectives } from './graphql'
import { GraphQLError } from 'graphql/error'
import { inspect } from 'graphql/jsutils/inspect'
import { getVariablesFromPathTemplate } from './pathTemplate'

const variableOperationInPathMustBeRequired: ValidationRule = (context: ValidationContext) => {
  let varDefMap: Record<string, VariableDefinitionNode> = Object.create(null)
  const paramDirective = context.getSchema().getDirective(OpenAPIDirectives.Param)
  const operationDirective = context.getSchema().getDirective(OpenAPIDirectives.Operation)

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

        for (const { node, type } of usages) {
          const varName = node.name.value
          const varDef = varDefMap[varName]
          const varType = typeFromAST(context.getSchema(), varDef.type)
          const varTypeStr = inspect(varType)

          const paramDirectiveValue = getDirective(varDef, OpenAPIDirectives.Param)

          if (paramDirective && paramDirectiveValue) {
            const paramDirectiveArguments = getDirectiveArguments(
              paramDirective,
              paramDirectiveValue
            )
            const inValue = (paramDirectiveArguments?.in as string | undefined)?.toLowerCase()
            let parameterName = varName
            const nameOverride = paramDirectiveArguments.name as string
            if (nameOverride) {
              parameterName = nameOverride
            }
            if (inValue === 'path') {
              if (!(type instanceof GraphQLNonNull)) {
                context.reportError(
                  new GraphQLError(
                    `Variable "$${varName}" of type "${varTypeStr}" must be defined as "${varTypeStr}!", as it is used in a "PATH" argument.".`,
                    {
                      nodes: [varDef, node, operation],
                    }
                  )
                )
                return
              }
            }

            if (operationDirective && operationDirectiveValue) {
              const directiveArguments = getDirectiveArguments(
                operationDirective,
                operationDirectiveValue
              )
              const pathDefinition = directiveArguments['path']

              const pathVariables = new Set(getVariablesFromPathTemplate(pathDefinition as string))

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
  variableOperationInPathMustBeRequired,
]
