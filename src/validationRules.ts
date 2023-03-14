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
import { getParameterName } from './utils'

const openApiOperationValidations: ValidationRule = (context: ValidationContext) => {
  let varDefMap: Record<string, VariableDefinitionNode> = Object.create(null)
  const paramDirective = context.getSchema().getDirective(OpenAPIDirectives.Param)!
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

          let inValue
          const paramDirectiveValue = getDirective(varDef, OpenAPIDirectives.Param)
          const parameterName = getParameterName(node, varDef)
          if (paramDirectiveValue) {
            const paramDirectiveArguments = getDirectiveArguments(
              paramDirective,
              paramDirectiveValue
            )
            inValue = (paramDirectiveArguments?.in as string | undefined)?.toLowerCase()

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

export const gqlValidationRules: ValidationRule[] = [...specifiedRules, openApiOperationValidations]
